# Auditoría de arquitectura y escalabilidad — Stick Live

**Fecha:** 19/07/2026 · **Última actualización:** 27/07/2026 · **Alcance:** monorepo completo (`apps/*`, `packages/*`, `deploy/`, `infra/`)
**Horizonte evaluado:** 3 años — multi-liga, picos de tráfico en directo, consistencia de datos.

> Nota previa: el backend **no es FastAPI**. Es un monorepo TypeScript: `apps/api` (Hono + `@hono/node-server`), `apps/etl`, `apps/scraper` (Playwright/Cheerio), `apps/web` (Next.js **16** App Router), `packages/db` (pg + SQL plano, sin ORM). ~28.700 líneas de TS/TSX.
>
> Esta auditoría **no repite** lo ya resuelto en `AUDITORIA_TECNICA.md` (S1-S9, B1-B4, A1-A4). Parte de ahí y ataca lo que sigue abierto o ha aparecido después.

> ## Estado a 27/07/2026
>
> **Bloque 1 (crítico): completo.** Reconexión SSE, índices + caché en `/current` y `/live`, upsert idempotente de eventos, lock del ETL, caché de alineaciones. Todo desplegado.
>
> **Bloque 2 (corto plazo): completo.**
> - 2.1 Producción corre JS compilado desde `dist/`, sin `tsx` (PR #49).
> - 2.2 Imagen Docker multi-stage, usuario `node`, healthchecks y límites de memoria (#49).
> - 2.3 Servicio `migrate` en el compose (#49).
> - 2.4 Compose muerto eliminado (#36).
> - 2.5 **Infraestructura de tests de integración con Postgres real** + 16 tests de los dos puntos de más riesgo, verificados por mutación (#56). Cobertura ampliándose.
> - 2.6 CI que bloquea de verdad: typecheck, tests, lint, migraciones desde cero, build de la imagen, tests de integración.
> - 2.7 Retención de `scrape_logs`.
> - 2.8 Audit de dependencias **bloqueante** (#53); cinco `high` nuevos resueltos el 27/07 (#57).
>
> **Bloque 3 (visión 3 años): abierto.** Es el trabajo estructural pendiente — ver más abajo. Nada de esto es urgente hoy; sí es requisito **antes de la segunda federación**.
>
> **Fuera de la auditoría, pendientes operativos:** ampliar cobertura de tests sobre la infraestructura ya montada (loaders, snapshots del push-dispatcher, `runWorldskateScores`); mover el repo a una organización para activar el ruleset de protección de `main` (hoy dormido en repo personal privado); Next 16 y las deps del 27/07 pendientes de **desplegar y verificar los escudos** (`sharp` no lo prueba el CI).

---

## Bloque 1 — Crítico / Inmediato

### [ ] 1.1 El SSE se corta a los 30 minutos y degrada a polling REST justo en el tramo decisivo · **Crítico**

`apps/api/src/routes/match-stream.ts:26` fija `MAX_STREAM_DURATION_MS = 30 * 60 * 1000`. Al vencer, emite `event: timeout` y cierra.

En el cliente (`apps/web/src/components/match/MatchCenterClient.tsx:108-111`) el handler de `timeout` hace `es.close()` y `setSseStatus('idle')`. **No reconecta.** Lo que ocurre después es el fallback de las líneas 129-142: `setInterval(refreshData, 30_000)` contra `GET /matches/:id`.

Un partido de hockey patines dura ~70-90 minutos reales (2×25 + descanso + prórroga). Consecuencia: **a partir del minuto 30 de conexión, el 100% de los espectadores está en polling REST de 30 s**, no en SSE. Es exactamente el escenario de la pregunta "¿aguanta el minuto final?": en el minuto final nadie está en SSE.

Además `GET /matches/:id` (`apps/api/src/routes/match-detail.ts`) es una consulta pesada (partido + eventos + alineaciones + jugadores) y **no lleva ningún `Cache-Control`** — cada cliente pega directo a Postgres.

**Fix inmediato (bajo riesgo):** en el handler de `timeout`, reabrir el `EventSource` tras 1-2 s en vez de cerrar. Añadir un `key` de reconexión al efecto. 15 líneas.
**Fix correcto:** subir `MAX_STREAM_DURATION_MS` a ~2 h y apoyarse en `Last-Event-ID` para reanudar sin reenviar el snapshot completo.

---

### [ ] 1.2 `/matches/current` sin caché ni índice compuesto es el primer cuello de botella real · **Crítico**

`apps/web/src/hooks/useLiveScores.ts:12` sondea cada 25 s con `cache: 'no-store'` (`getCurrentMatchesFresh`, `apps/web/src/lib/api/client.ts:260`) **desde cada navegador, directo a la API** (no pasa por la caché de Next).

La query (`apps/api/src/routes/live.ts`, ruta `/current`) hace 4 JOINs (`matches` → `seasons` → `competitions` → `teams` ×2) sobre una ventana de `[hoy-8d, hoy+15d]`. En `packages/db/migrations/001_initial_schema.sql:282-286` los índices son **separados**: `idx_matches_season`, `idx_matches_status`, `idx_matches_scheduled`. No hay ninguno compuesto útil para este patrón.

Cuentas: 500 usuarios en la home = **20 req/s** de esa query, sin caché alguna. Y no hay `Cache-Control` en ninguna ruta de datos — sólo en `meta.ts:30`, `team-logo.ts` y `player-photo.ts` (`grep Cache-Control apps/api/src` lo confirma).

**Fix:**
```sql
CREATE INDEX CONCURRENTLY idx_matches_season_scheduled ON matches(season_id, scheduled_at);
CREATE INDEX CONCURRENTLY idx_matches_live_partial ON matches(scheduled_at) WHERE status = 'live';
```
+ micro-caché en memoria de 3-5 s sobre `/current` y `/live` (un `Map` con TTL basta hoy; Redis cuando haya >1 nodo)
+ `Cache-Control: public, max-age=5, stale-while-revalidate=30` para que Caddy y el navegador absorban la ráfaga.

Con eso, 500 usuarios pasan de 20 qps a **≤0,3 qps** contra Postgres.

---

### [ ] 1.3 El pool de 10 conexiones se comparte y el hub SSE recalcula alineaciones cada 15 s · **Alto**

`packages/db/src/client.ts:24` → `max: 10` por defecto. El mismo Postgres lo comparten `api`, `etl` y los scrapes manuales por túnel SSH (`docker-compose.prod.yml`).

El hub de `match-stream.ts` dispara por partido en vivo y cada `POLL_INTERVAL_MS` (15 s) **tres queries**: partido, eventos y **alineaciones completas con JOIN a `players`** (`fetchMatchSnapshot`, líneas ~100-130). Las alineaciones no cambian durante el partido salvo el contador de goles/asistencias.

Una jornada normal de OK Liga = 8-10 partidos simultáneos → 30 queries cada 15 s sólo de fan-out, concurrentes con el ciclo del ETL (`cron-live.ts` cada 45 s, que a su vez hace fichas + push diffs con ~10 queries por partido). Con `statement_timeout` de 15 s y 10 conexiones, un pico de scraping puede hacer esperar al SSE.

**Fix:** cachear alineaciones en el hub y refrescarlas cada N ticks (o sólo si cambia el conteo de eventos); `DATABASE_POOL_MAX` distinto para api (20) y etl (5); considerar PgBouncer cuando entren más ligas.

---

### [ ] 1.4 `match_events` se reescribe entera (DELETE + INSERT) cada 45 s: los IDs de evento cambian en cada ciclo · **Alto**

`packages/db/src/queries/matches.ts:222-262` (`replaceMatchEvents`) borra todos los eventos del partido y los reinserta. Se llama desde `apps/scraper/src/scrapers/fep/fep-ficha.scraper.ts:732` dentro de `withTransaction` (bien: hay aislamiento, un lector no ve el hueco).

El problema no es el aislamiento sino la **identidad**: `match_events.id` es `gen_random_uuid()`, así que **cada gol cambia de UUID cada 45 segundos**. Consecuencias reales:

- El SSE reenvía el array completo y el cliente hace `setLiveData(parsed)` — el `key` de React de cada fila del timeline cambia cada ciclo (re-render completo del timeline en directo).
- El `push-dispatcher` no puede diffear por ID; tiene que hacerlo por **conteo** (`snapshotPlayerEventCounts`, `apps/etl/src/push-dispatcher.ts`). Eso es frágil: si la fuente corrige un evento (quita uno y añade otro en el mismo ciclo), el conteo no cambia y **la notificación se pierde**.
- Imposible referenciar un evento de forma estable (deep-link a un gol, moderación, correcciones manuales).

El `sourceRef` ya existe y es estable (`fep_event_{idp}_{rowIdx}`) pero **no se usa para idempotencia**: no hay UNIQUE sobre él.

**Fix:**
```sql
CREATE UNIQUE INDEX CONCURRENTLY uq_match_events_source_ref
  ON match_events(match_id, source_ref) WHERE source_ref IS NOT NULL;
```
y sustituir el DELETE+INSERT por `INSERT ... ON CONFLICT (match_id, source_ref) DO UPDATE` + `DELETE WHERE source_ref <> ALL($refs)`. Con eso los IDs son estables y el diff del push puede hacerse por ID en lugar de por conteo.

---

### [ ] 1.5 Interpolación de variables directamente en SQL · **Medio (patrón, no explotable hoy)**

- `apps/etl/src/cron-live.ts`: `INTERVAL '${WINDOW_HOURS} hours'` en tres queries (viene de env).
- `apps/api/src/routes/live.ts`: `INTERVAL '${win.backDays} days'` — **este sí procede de query params** (`?days=`), saneado en `resolveCurrentWindow` (`apps/api/src/lib/match-window.ts`, con test en `match-window.test.ts`).

Hoy está cubierto por el saneado, pero es un patrón que sólo aguanta mientras nadie toque `resolveCurrentWindow` sin mirar. **Fix:** parametrizar con `NOW() - ($1 || ' days')::interval` y quitar la interpolación de plantilla del SQL en todo el repo.

---

### [ ] 1.6 El lock anti-solapamiento del ETL es opcional y silencioso · **Medio**

`deploy/etl-scheduler.sh` usa `flock` sólo si existe: `if command -v flock ... else LOCK=""` y sigue con un `echo` de aviso. La imagen es `node:22-bookworm-slim` (`deploy/Dockerfile:6`), donde `util-linux` viene recortado. Si no está, **el scheduler corre sin ningún lock** y un scrape manual por túnel SSH puede solaparse con el cron sobre las mismas filas.

**Fix:** `RUN apt-get update && apt-get install -y --no-install-recommends util-linux` en el Dockerfile, y convertir el aviso en fallo duro. Alternativa más robusta: lock en Postgres con `pg_try_advisory_lock`, que además funciona entre máquinas.

---

## Bloque 2 — Corto plazo (rendimiento y madurez de producción)

### [x] 2.1 Producción ejecuta TypeScript sin compilar — **resuelto (21/07/2026)**

`docker-compose.prod.yml`: `command: npx tsx apps/api/src/index.ts` y `sh deploy/etl-scheduler.sh` → `npx tsx src/cron-live.ts`. `tsx` es *devDependency*. Implicaciones: sin type-check en el arranque, transpilación en cada boot, `npx` resolviendo en runtime, y el `npm audit --omit=dev` del CI **no cubre lo que realmente corre en producción**.

> **Resuelto empaquetando, no con `tsc` a secas.** El `build: tsc` que ya había en cada `package.json` no servía tal cual: los paquetes exponen TypeScript directamente (`"main": "./src/index.ts"`), así que compilar por separado obligaba a reescribir todos los `main`/`exports` y a resolver los imports relativos que cruzan de una app a otra (`cron-live.ts` importa `../../scraper/src/...`), que acaban en referencias de proyecto y rutas frágiles.
>
> `scripts/build-server.mjs` empaqueta con esbuild los 16 entrypoints a `dist/`, conservando la jerarquía de directorios para que los stack traces de producción se lean sin traducir. Todo `node_modules` queda **externo** a propósito: `@sentry/node` instrumenta interceptando la carga de módulos y dentro de un bundle deja de verla, y `playwright` resuelve rutas propias en runtime.
>
> Tres cosas que aparecieron por el camino y no eran obvias:
>
> 1. **Rutas resueltas desde el propio fichero.** `migrate.ts` leía `../migrations` y `run-pipeline.ts` escribía en `../../web/public/escudos` —esta última, además, un volumen compartido—. Al correr desde `dist/` esos cálculos apuntan a otro sitio. Ahora se fijan por entorno (`MIGRATIONS_DIR`, `ESCUDOS_DIR`) desde la imagen.
> 2. **Los runbooks se habrían roto en silencio.** `docs/RUNBOOK_COMPETICIONES.md` está lleno de `$DC exec etl npx tsx <script>.ts`, incluido el alta de una competición nueva. Sin `tsx` en la imagen, ese flujo habría dejado de funcionar y el fallo habría salido en septiembre, al arrancar la temporada. Los scripts operativos autocontenidos van empaquetados; los que leen ficheros del repo o lanzan subprocesos (`import-*`) se ejecutan desde el portátil por el túnel SSH, que es para lo que existe.
> 3. **Dos dependencias fantasma.** `apps/api` importaba `@sports/analytics` y `packages/db` importaba `@sports/shared-types` sin declararlos; funcionaban sólo porque npm los eleva a la raíz. Y `packages/db/tsconfig.json` excluía `scripts/` del typecheck, justo donde viven `purge-scrape-logs` y `verify-event-upsert`.

### [x] 2.2 Imagen Docker única, monolítica y como root — **resuelto (21/07/2026)**

Un solo `deploy/Dockerfile` sin multi-stage sirve a `api`, `web` y `etl`. Arrastra Playwright, el build de Next y todas las devDependencies a los tres contenedores. Corre como `root`. No hay `healthcheck` para `api` ni `web` (sólo Postgres lo tiene), ni `deploy.resources.limits`, así que un ETL desbocado puede tumbar la API en el mismo VPS.

> Tres etapas: `deps` (cacheable) → `builder` (typecheck + empaquetado + build de Next + `npm ci --omit=dev`) → `runtime`, que sólo recibe el resultado. La imagen final no lleva código fuente, ni toolchain, ni devDependencies, y corre como `node`.
>
> El typecheck va **dentro** del build de la imagen, antes de empaquetar: esbuild transpila sin mirar tipos, así que sin esa puerta un error de tipos llegaría a producción convertido en fallo de runtime. El CI ya lo comprueba, pero la imagen no debe depender de que alguien haya mirado el CI.
>
> Healthchecks con `node -e` y `fetch`, no con `curl`: la imagen slim no lo trae y añadirlo es superficie de ataque a cambio de nada. El del ETL es distinto —no expone HTTP— y va contra un fichero de latido que el planificador toca en cada vuelta; así se distingue *colgado* de *muerto*, que es lo que Docker ya ve por su cuenta.
>
> Límites de memoria por servicio sumando ≈3,4 GB de los 4 GB del VPS. El objetivo concreto es que una fuga en el ETL no se lleve por delante a Postgres, que es el único cuyos datos no se reconstruyen volviendo a scrapear.

### [x] 2.3 Migraciones fuera del despliegue — **resuelto (21/07/2026)**

No hay servicio `migrate` en `docker-compose.prod.yml`. `packages/db/src/migrate.ts` existe pero se ejecuta a mano (`docs/DEPLOY.md`). 34 migraciones acumuladas y ninguna garantía de que prod esté al día.

> Servicio `migrate` con `restart: "no"`, del que `api` y `etl` dependen con `condition: service_completed_successfully`. Si una migración falla, el despliegue se para ahí en vez de seguir a medias.
>
> Esto elimina el procedimiento especial que había en `docs/DEPLOY.md` para releases cuyo código depende del esquema nuevo: cuatro comandos en un orden concreto que sólo funcionaban si te acordabas. El 20/07/2026 un despliegue se quedó exactamente así —`etl` parado una hora, migraciones sin aplicar, `api`/`web` con imagen de 24 h antes—. Un paso manual que hay que recordar en el momento justo no es un procedimiento, es un fallo esperando turno.
>
> Queda pendiente la otra mitad del fix propuesto: **comprobación de versión de esquema al arrancar la API**. El servicio `migrate` cubre el despliegue normal, pero no el caso de arrancar contra una base restaurada de un backup viejo.

### [x] 2.4 `infra/docker/docker-compose.yml` está muerto — **resuelto (PR #36)**

Referenciaba `apps/api/Dockerfile`, que **no existe** (`find . -name Dockerfile*` sólo devuelve `apps/scraper/Dockerfile` y `deploy/Dockerfile`), así que cualquier `up` sin nombrar servicio fallaba. Además el servicio `scraper` levantaba crons contra la BD de desarrollo sin pedirlo, y `version: '3.9'` generaba un warning en cada invocación.

Reducido a lo que de verdad es: la base de datos de desarrollo. Los dos servicios muertos fuera, `version` fuera, y el README corregido — documentaba `-f docker-compose.dev.yml` en solitario, que no funciona porque ese fichero es un override sin `image`.

### [~] 2.5 Testing — **infraestructura resuelta (21/07/2026), cobertura en marcha**

Existían 6 ficheros de test para ~28.700 líneas, **todos de lógica pura**. Ni una línea de SQL probada, que en este código es donde vive la parte difícil.

> **Lo que se montó.** `tests/integration/` con Postgres real y las migraciones reales, `docker-compose.test.yml` para local, y un job `integration` bloqueante en CI.
>
> **Postgres de verdad, no un emulador.** Se descartó `pg-mem` y similares: este código usa índices únicos **parciales** con `WHERE`, `ON CONFLICT ... WHERE`, `make_interval` y borrado por `ctid`. Los emuladores no soportan buena parte de eso, así que darían verde donde producción rompe. Un test que miente es peor que no tener test.
>
> **Aislamiento por TRUNCATE, no por transacción.** El patrón habitual —abrir transacción, correr el test, ROLLBACK— no sirve aquí: `packages/db` expone un pool singleton y el código de producción llama a `db.query()` cogiendo su propia conexión, así que una transacción del test le sería invisible. Truncar es más lento y más honesto: la función se ejecuta igual que en producción.
>
> **Guardarraíl contra el desastre.** `limpiar()` hace TRUNCATE de todo, y en este proyecto es normal tener abierto un túnel SSH contra el Postgres de producción. Si `DATABASE_URL` apunta a una base sin "test" en el nombre, los tests abortan antes de tocar nada.
>
> **Las migraciones se aplican desde los `.sql` reales**, no desde un esquema de pruebas paralelo. Un esquema duplicado se desincroniza en la primera migración que alguien olvide copiar, y a partir de ahí los tests validan una base que no existe en ningún sitio.

**Primeros 16 tests**, elegidos por dónde más duele:

| Qué | Por qué justo eso |
|---|---|
| `replaceMatchEvents` (9) | Corre cada 45 s por partido en juego y de él depende el diff del push. Cuando hacía DELETE+INSERT, los ids cambiaban en cada ciclo y se re-notificaba cada gol. Motivó las migraciones 034/035/036 |
| `sweepStaleLive` (7) | El watchdog escrito ese mismo día **sin cobertura**. Cubre tanto que limpie lo colgado como que **no toque un partido en juego de verdad**, que sería peor que el problema original |

**Se verificó que los tests fallan cuando deben.** Se mutaron ambas funciones a propósito —volver a DELETE+INSERT, y bajar el umbral del watchdog a 0 horas— y fallaron exactamente los 4 tests que describen esos fallos. Sin esa comprobación no se sabe si un test verde prueba algo o simplemente no mira.

**Lo que sigue pendiente**, por orden de valor:

| Zona | Riesgo si rompe | Cómo |
|---|---|---|
| Parsers de la ficha | La fuente cambia el HTML → se pierde el directo entero | Ya hay 37 tests con golden files reales (PR #36). Faltan capturas de descanso, prórroga, penaltis e incomparecencia |
| Loaders (`match.loader.ts`) | Duplicados y partidos fantasma | Integración; la infraestructura ya está puesta |
| `push-dispatcher.ts` (862 líneas) | Notificaciones duplicadas o perdidas a usuarios reales | Las funciones de diff ya tienen 16 tests unitarios; faltan las de snapshot, que tocan BD |
| `runWorldskateScores` | Directo de World Skate | Integración |

### [x] 2.6 CI que no bloquea nada relevante — **resuelto**

`lint` y `npm audit` iban con `continue-on-error: true`, no había build de la imagen ni prueba de migraciones. Ahora:

- **`lint` bloquea.** Había 21 avisos en 3 ficheros: 11 en `verify-event-upsert.ts` (expresiones usadas como sentencias), 9 falsos positivos de `no-undef` en `sw.js` (faltaban los globales de service worker en la config de ESLint) y un `any` en `migrate.ts`. Arreglados los 21; el repo está a cero.
- **Job `migrations`**: Postgres limpio, todas las migraciones desde cero, reaplicación para comprobar idempotencia y verificación de que existen los 4 índices del directo.
- **Job `docker`**: construye `deploy/Dockerfile` y comprueba que la imagen trae `flock`, del que depende el lock del `etl-scheduler`.
- **Protección de rama** en `main` exigiendo los tres jobs.

Pendiente y consciente: **el `audit` sigue sin bloquear**. Hay 8 vulnerabilidades en dependencias de producción (4 altas) y una exige subir `node-cron` con cambio de API. Ponerlo en rojo permanente sería la forma más rápida de que se ignore. Ver el punto 2.8.

### [x] 2.8 Vulnerabilidades en dependencias de producción — **resuelto (21/07/2026)**

`npm audit --omit=dev` reportaba 8 (4 moderadas, 4 altas), concentradas en `undici` y en la cadena `node-cron → uuid`.

> **Al ir a arreglarlo, el diagnóstico ya no valía.** `undici` y `node-cron` habían desaparecido por el camino —`node-cron` ni siquiera seguía siendo dependencia, sólo quedaban menciones en comentarios—. Lo que había realmente eran cinco avisos en dos paquetes: **nodemailer** y **Next**.
>
> Y de los cuatro avisos de Next, sólo dos nos aplicaban: el DoS del Image Optimizer (usamos `remotePatterns` con `sidgad.cloud`) y el cache poisoning de RSC. El de *Middleware/Proxy bypass* es específico de **Pages Router con i18n** y usamos App Router. Merece la pena leer los avisos en vez de contarlos.
>
> Resuelto en tres PRs: **#51** (nodemailer 8→9, no explotable en nuestro código pero barato de cerrar), **#52** (Next 14→16 manteniendo React 18, que resultó no ser obligatorio) y este, que quita el `continue-on-error`.
>
> **Queda un `postcss` moderate sin arreglo** dentro del propio Next (`node_modules/next/node_modules/postcss`): npm llega a proponer bajar a `next@9.3.3`. Es de build y el CSS que procesamos es nuestro. Por eso el gate va a `--audit-level=high`, con un segundo paso informativo que lista los moderate sin bloquear — bloquear en `high` y no mirar nunca lo de abajo es cómodo hoy y ciego en seis meses.
>
> Nota que conecta con 2.1: este audit **no significaba lo mismo antes**. Hasta el PR #49 producción corría con `npx tsx`, que es devDependency, así que `--omit=dev` auditaba algo distinto de lo que se ejecutaba en el servidor. Ahora sí coinciden.

### [x] 2.7 Sin retención de datos — **resuelto para `scrape_logs`**

`scrape_logs` inserta una fila por ejecución de loader y crecía indefinidamente. Al mirarlo de cerca aparecieron dos cosas: **nadie lee esa tabla** (`getLastScrapeLog` existe en `packages/db` pero no tiene un solo consumidor), y crece más de lo que parecía — con World Skate en el planificador cada 5 minutos son ~1.000 filas al día, más las de `cron-live` en sus bucles de 45 s durante los partidos.

Resuelto con `packages/db/scripts/purge-scrape-logs.ts`, que corre a diario desde `etl-scheduler.sh` y conserva 30 días (`SCRAPE_LOGS_RETENTION_DAYS`). Borra por lotes para no mantener un lock largo ni inflar el WAL de golpe. La migración 037 añade el índice por `scraped_at` que la purga necesita: el que había, `(scraper_key, scraped_at DESC)`, no sirve para barrer por fecha.

**Pendiente:** el archivado de `match_events`, que es harina de otro costal — son datos de producto, no logs, y la vía es particionar por temporada (punto 3.5) en vez de borrar.

---

## Bloque 3 — Visión 3 años (multi-liga, alto tráfico, consistencia)

### [ ] 3.1 La internacionalización sólo llega a la interfaz, no a los datos · **Bloqueante para expandir**

Dos problemas distintos:

**(a) Los diccionarios van enteros al bundle de todos.** `apps/web/src/lib/i18n.tsx` es `'use client'` e importa **estáticamente los 5 JSON** (`es, en, pt, fr, it`) en `DICTS`. Cada usuario descarga los cinco idiomas. Con 5 locales y ~18 secciones aún es asumible; con 12 ligas y sus términos, no. **Fix:** servir el diccionario del locale activo desde el Server Component del layout `[locale]` y pasarlo por props, o `dynamic import` por locale.

**(b) Los datos no son multilingües en absoluto.** En `001_initial_schema.sql` son `TEXT` libre en español:
- `competitions.name` → "OK Liga"
- `rounds.name` → **"Jornada 1"**
- `season_teams.group_name` / `standings.group_name` → **"Grupo A"**
- `players.position` → **"portero", "defensa"**
- `match_events.detail` → texto libre

El día que entre la liga portuguesa, **un usuario italiano leerá "Jornada 1" y un español leerá "Giornata 1"** en la misma pantalla. No es un bug futuro: es determinista.

**Fix propuesto (por orden de esfuerzo):**
1. **Enumerables → claves canónicas.** `players.position` pasa a un enum (`goalkeeper|defender|forward`) y se traduce en el JSON de locales. Igual `round_type`. Migración barata, gana ya.
2. **Rondas y grupos → estructura + plantilla.** Guardar `rounds.number` + `round_type` (ya existen) y renderizar `t('round.matchday', {n})`. Sólo guardar `name` cuando sea un nombre propio no traducible ("Copa del Rey").
3. **Nombres propios → columna `jsonb`.** `competitions.name_i18n = {"es": "...", "en": "..."}` con `name` como fallback. Evita una tabla de traducciones y es indexable.

Hacer esto **antes** de meter la segunda federación cuesta días; hacerlo después cuesta una migración de datos con riesgo.

### [~] 3.2 El acoplamiento a la FEP está repartido por todo el código · **primer trozo hecho (20/07/2026)**

> **Actualización tras el Europeo Sub-17.** Este punto dejó de ser teórico el
> 20/07/2026: con el Europeo en juego, World Skate mostraba marcador pero
> **ninguna** cronología, crono ni alineación. Aparecieron tres acoplamientos
> encadenados, todos con la misma forma — *una suposición razonable sobre la FEP
> convertida en requisito para todas las fuentes*:
>
> 1. **`cron-live` filtraba las actas con `source_ref LIKE 'fep_match_%'`.**
>    Todo lo que no fuera FEP se descartaba en silencio. Ninguna otra
>    competición podía tener eventos *por diseño*.
> 2. **`FepFichaScraper` usaba `sidgadPost`**, el cliente por defecto de la FEP,
>    así que ni siquiera podía alcanzar otro portal de sidgad.
> 3. **`parseLineups` exigía el patrón `"OKM - NOMBRE"`**, el prefijo de licencia
>    federativa. En un campeonato de selecciones no existe: se descartaban los
>    20 jugadores y sólo sobrevivía el cuerpo técnico (8 filas de 28).
>
> Resuelto con `apps/scraper/src/core/sources.ts`: un registro de fuentes por
> prefijo de `source_ref` con su configuración de portal. `SidgadClient` ya sabía
> reescribir `rfep_*` → `{portal}_*`, así que **añadir una fuente sidgad nueva es
> añadir una entrada en `SOURCES`**. Los `source_ref` de evento llevan el prefijo
> de su fuente (`wse_event_…`); la FEP conserva `fep_event_` a propósito, porque
> cambiarlo reescribiría sus refs y con ellas los ids que estabilizó la 035.
>
> De rebote apareció un fallo latente: `activeSecondarySeasons` alimentaba
> `FepMatchesScraper` con temporadas de cualquier fuente. No había hecho daño
> porque el `ON CONFLICT` no toca `season_id`, pero podía insertar partidos bajo
> la temporada equivocada. Ahora filtra por competiciones de la FEP.
>
> **Cuarto acoplamiento, esta vez de planificación (20/07/2026, por la noche).**
> Con las actas ya funcionando, aparecieron partidos del Europeo colgados en
> "EN JUEGO" cuatro horas después de empezar. La causa no estaba en ningún
> scraper sino en cómo se planifican: `deploy/etl-scheduler.sh` es un bucle
> **secuencial**, y `cron-live` se queda dentro de su bucle activo mientras haya
> partidos en juego (`MAX_RUNTIME_MIN`, 180 por defecto). World Skate estaba
> puesto **detrás** de él, así que durante un torneo no le llegaba el turno
> nunca. Y como su estado `live` lo infiere `inferStatus` del reloj y caduca a
> las 3 h, hacía falta un scrape para deshacerlo. Círculo cerrado: el `live`
> fantasma mantenía vivo el bucle, y el bucle impedía el scrape que lo habría
> borrado.
>
> El acoplamiento de fondo es el mismo de siempre con otra cara: **`cron-live`
> era "el bucle de la FEP" y todo lo demás vivía fuera**, en un planificador que
> asume tareas cortas. Arreglado moviendo el scrape de World Skate al ciclo de
> 45 s (`runWorldskateScores`), con su propio snapshot→diff para que el push
> funcione igual; la lógica compartida se extrajo a
> `apps/scraper/src/scrapers/worldskate/run-worldskate.ts`, con el pipeline
> **inyectado** para no invertir la dependencia scraper→ETL. En el scheduler
> World Skate pasa a ir **antes** de `cron-live` y cubre sólo el reposo. De
> paso, el directo de World Skate gana resolución: de 5 minutos a 45 segundos.
>
> Y una lección que va más allá de este bug: **el estado `live` inferido del
> reloj es correcto sólo mientras el scraper corra.** Cualquier parón lo
> convierte en mentira permanente, y la portada es justo donde más se nota. Por
> eso se añadió `apps/etl/src/stale-live-watchdog.ts`, que al final de cada
> ciclo devuelve a `scheduled` lo que lleve más de `STALE_LIVE_HOURS` (5) en
> `live` y avisa a Sentry. No arregla la causa —avisa de ella— pero el usuario
> deja de ver un directo falso aunque el fallo sea de otro sitio.
>
> **Lo que sigue pendiente** es la parte de configuración: los `idc` y las
> temporadas siguen viniendo de constantes y de `SEASON_ID`. La tabla
> `competition_sources` que se propone abajo sigue siendo el objetivo.



Puntos duros encontrados:

| Sitio | Acoplamiento |
|---|---|
| `apps/etl/src/cron-live.ts` (`runFichasForActiveMatches`) | `WHERE m.source_ref LIKE 'fep_match_%'` |
| `apps/etl/src/cron-live.ts` | `SPORT_SLUG = 'hockey-patines'` constante de módulo |
| `apps/scraper/.../fep-ficha.scraper.ts:29` | `PLAYOFF_IDCS = ['3481', '3484']` hardcodeado |
| `cron-live.ts` (`main`) | Concepto de "season **primaria**" vía `SEASON_ID` de entorno; las demás son ciudadanas de segunda (`scrapeSeasonScores` no emite push de gol-jugador) |
| `deploy/Dockerfile` | `NEXT_PUBLIC_SEASON_ID` **horneada en el build** de la web |
| `apps/etl/src/` | 8 scripts `seed-*.ts` / `backfill-*.ts` / `merge-*.ts` de un solo uso conviviendo con el código de producción |
| `deploy/etl-scheduler.sh` | Bucle **secuencial** con `cron-live` dentro: cualquier tarea que vaya detrás se queda sin turno mientras haya partidos en juego (hasta 180 min) |

Traducción operativa: **cada liga nueva exige tocar código, rebuild de la imagen y redeploy.** A 3 años y N ligas eso no escala ni en tiempo ni en riesgo.

**Arquitectura objetivo:**
```sql
CREATE TABLE competition_sources (
  id              uuid PRIMARY KEY,
  competition_id  uuid NOT NULL REFERENCES competitions(id),
  source_id       uuid NOT NULL REFERENCES data_sources(id),
  scraper_key     text NOT NULL,          -- 'fep_sidgad' | 'worldskate_sidgad' | 'fpp' ...
  external_ids    jsonb NOT NULL,         -- {"idc":"3150","playoff_idcs":["3481"]}
  poll_policy     jsonb NOT NULL,         -- {"liveIntervalS":45,"windowHours":2}
  is_active       boolean NOT NULL DEFAULT true
);
```
Con un registro de scrapers por `scraper_key` (el patrón multi-fuente ya está esbozado en `apps/scraper/src/core/fep-source.ts` y el commit `987713d`) y un runner que itere `competition_sources` en vez de leer `SEASON_ID`. **Ninguna liga nueva debería requerir un deploy.**

Paralelamente: mover los `seed-*.ts` a `apps/etl/scripts/` fuera del build, y eliminar `NEXT_PUBLIC_SEASON_ID` del Dockerfile (que la home resuelva las temporadas activas por API, como ya hace `/matches/current`).

### [ ] 3.3 Zonas horarias y contexto de país

`competitions.country TEXT NOT NULL DEFAULT 'ES'` y ninguna columna de zona horaria en `competitions`, `seasons` ni en la sede (`matches.venue_name/venue_city` son texto suelto). `matches.scheduled_at` sí es `timestamptz`, correcto — pero el scraper interpreta las horas de la fuente en TZ europea (`apps/scraper/src/core/eu-timezone.ts`), asunción que se rompe con cualquier fuente que publique en hora local distinta. Ya hubo un incidente de TZ (junio).

**Fix:** `competitions.timezone` (IANA) y tabla `venues` normalizada con su TZ, en lugar de dos columnas de texto en `matches`.

### [ ] 3.4 El tiempo real tiene techo en un solo proceso

Tres estados viven **en memoria del proceso API**:
- `hubs` (`match-stream.ts:170`) — los pollers SSE
- `activeConnections` (`match-stream.ts:224`) — el límite de 1000
- `store` del rate limit (`apps/api/src/lib/rate-limit.ts:14`)

Los tres impiden escalar horizontalmente: con dos réplicas, cada una poll-ea la BD por su cuenta, el límite de conexiones se duplica y el rate limit se divide.

Además el flujo actual es **pull**: el ETL escribe en Postgres → la API sondea Postgres cada 15 s → el cliente recibe. Latencia acumulada de hasta 15 s **encima** de los 45 s del ciclo del scraper.

**Arquitectura objetivo (invertir el flujo):**
```
scraper/ETL --publica--> Redis pub/sub (canal match:{id})
                              |
                    API (N réplicas, sólo suscriptor)
                              |
                        SSE fan-out --> clientes
```
Beneficios: cero queries de polling, latencia de fan-out en milisegundos, réplicas de API sin estado, rate limit y contador de conexiones en Redis. Con Postgres `LISTEN/NOTIFY` se consigue el 80% del beneficio sin añadir Redis, si se quiere una fase intermedia barata.

### [ ] 3.5 Escalado de datos

- **Particionar `match_events`** por temporada (o rango de fecha) cuando pase de unos pocos millones. Hoy sólo hay `idx_match_events_match`.
- **Materializar lo caro.** `season-stats.ts` (303 líneas en `season-overview.ts` y su gemelo) calcula líderes de temporada al vuelo con `revalidate: 120`. Con 10 ligas eso es una vista materializada refrescada por el ETL, no una query por request.
- **Standings**: hoy se recalculan por scraping. Con más ligas conviene poder **derivarlas** de `matches` como fuente de verdad y usar el scraping sólo para reconciliar — así se detectan discrepancias con la fuente en vez de heredarlas ciegamente.
- **Escudos y fotos a CDN.** Hoy son un volumen Docker (`escudos:`) servido por Next y por `apps/api/src/routes/team-logo.ts`. Es ancho de banda y CPU de Node en el mismo VPS que atiende el directo. Objeto en S3/R2 + CDN.

### [ ] 3.6 Infraestructura: un único VPS sin HA

Un Hetzner con Postgres, API, web, ETL y Caddy en el mismo host (`docker-compose.prod.yml`). Sin réplica de lectura, sin failover, sin staging. Hay `deploy/backup-db.sh` y `verify-backup.sh` — bien; conviene **probar el restore completo trimestralmente** y documentar el RTO/RPO real.

Orden razonable de inversión: (1) entorno de staging con la misma imagen, (2) Postgres gestionado o réplica de lectura, (3) segunda instancia de API tras Caddy cuando el 3.4 esté hecho.

---

## Resumen de prioridades

| # | Acción | Bloque | Estado |
|---|---|---|---|
| 1 | Reconexión SSE tras `timeout` | 1 | ✅ hecho |
| 2 | Índice compuesto + micro-caché + `Cache-Control` en `/current` y `/live` | 1 | ✅ hecho |
| 3 | `UNIQUE(match_id, source_ref)` + upsert de eventos | 1 | ✅ hecho (migr. 034/035/036) |
| 4 | `flock` garantizado / advisory lock en Postgres | 1 | ✅ hecho |
| 5 | Cachear alineaciones en el hub SSE | 1 | ✅ hecho |
| 6 | Golden files de los parsers de ficha | 2 | ✅ hecho (#36, 37 tests) |
| 7 | Compilar TS y multi-stage Docker | 2 | ✅ hecho (#49) |
| 8 | Servicio `migrate` en el compose de prod | 2 | ✅ hecho (#49) |
| 8b | Tests de integración con Postgres real | 2 | ✅ infraestructura + 16 tests (#56) |
| 8c | Audit de dependencias bloqueante | 2 | ✅ hecho (#53) |
| 9 | `position`/`round_type` a claves canónicas | 3 | ⬜ **antes de la 2ª liga** |
| 10 | `competition_sources` + runner genérico | 3 | ⬜ estructural |
| 11 | Redis pub/sub y API sin estado | 3 | ⬜ estructural (techo de un solo proceso) |
| 12 | i18n de datos (no sólo de la interfaz) | 3 | ⬜ bloqueante para expandir |

**Bloques 1 y 2, cerrados.** Lo que queda es bloque 3, todo estructural y sin urgencia hoy. La regla que no cambia: **9, 10 y 12 hay que hacerlos antes de la siguiente federación**, no después — meter una segunda liga sobre el modelo actual multiplica el acoplamiento a la FEP que ya costó desenredar en el 3.2.

**Siguiente paso recomendado cuando se retome:** el 9 (claves canónicas de `position`/`round_type`), que es un día de trabajo y desbloquea el 10. El 11 (Redis) sólo cuando el tráfico real lo pida; hoy un solo proceso sobra.
