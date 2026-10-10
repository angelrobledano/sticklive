# Changelog — Stick Live

Historial de hitos de producto y plataforma. El estado vivo está en [ESTADO_PROYECTO.md](./ESTADO_PROYECTO.md).

---

## Octubre 2026 — Fases de competición y directo por señal explícita

Diseño: [superpowers/specs/2026-10-08-fases-y-directo-explicito-design.md](./superpowers/specs/2026-10-08-fases-y-directo-explicito-design.md) · Operativa: [runbook-fases-y-directo.md](./runbook-fases-y-directo.md).

- **Directo fiable.** Un partido solo está EN DIRECTO si la fuente lo dice (feed FEP, match center de World Skate, acta). Se eliminan los seis sitios que lo deducían de la hora (calendarios FEP y World Skate, API, `MatchCard`/`classifyMatch` de la web y la app): un partido con la hora pasada y sin señal se muestra «Pendiente». Regla de estado única (`resolveStatusTransition`): una fuente que no informa del estado no lo toca (el calendario ya no puede devolver a «programado» un partido en juego). Final por acta (`periodo_fin`) además del feed. La ventana del directo y el watchdog cuentan desde el saque real (partidos que empiezan tarde).
- **World Skate (WSG Asunción).** Estado y marcador desde el match center; índice de `idp` con la hora (el ITA-COL femenino se llevaba el `idp` del cuarto de final sub-19); zona horaria con `Intl` — Asunción es UTC-3, no UTC-4 (todo el Mundial iba 1 h desplazado).
- **Fases de competición (migración 072, aditiva).** `Competition → Season → Phase → (Group) → Round → Match`. El formato es la secuencia de fases y sale de la estructura que ya publica la fuente (bloques de fase, «2 CUARTOS», «SEMIFINALES»…), con un único plan para liga, liga + playoff, grupos, grupos + final four, final four y eliminatoria. Fuera la ronda fija 100 del playoff, las listas de `idc` y la deducción por nombre de competición o por cronología. Las temporadas existentes reciben fases `legacy` sin reinterpretar nada y se completan al re-scrapear.
- **API y web.** `/seasons/:id/overview` y `/teams/:id` exponen `phases`, `stage` y `seriesGame` sin quitar campos. La web pinta cada fase eliminatoria con su cuadro (series al mejor de N, final four o cuadro): grupos + final four muestran clasificación **y** cuadro; la 2.ª semifinal ya no sale como «Final» durante las semis.

## Octubre 2026 — Supercopa como Final Four y arreglo de duplicados

- **Modelo FINAL_FOUR.** La Supercopa de España (masc./fem.) se modela como torneo a 4 mediante `competition_sources.external_ids.format='final_four'`: sus rondas se crean como `round_type='playoff'` con numeración canónica Semifinal=1 / Final=2 (`run-pipeline` + `seed-fep-competition --format=`), y la API expone `competitionFormat` en la ficha de temporada. La web la pinta como cuadro **Semifinal x2 → Final → campeón** (`FinalFourBracket`) con pestaña "Final Four", sin Jornadas ni Clasificación (antes aparecía como liga).
- **Fix de cruces duplicados (placeholders sintéticos).** La `source_ref` sintética incluye el `scheduledAt`, así que cuando la fuente cambió la hora de un partido se creó una fila nueva (p. ej. 16:00) y quedó la vieja (medianoche o la hora anterior), con el mismo cruce y día — afectaba a OK Liga M/F, Plata, Bronce y Supercopas (14 casos en prod). `reconcileSyntheticMatches` ahora deduplica **sintético-vs-sintético** por cruce+día en Madrid (gana el que tiene hora / el más reciente), además de la regla sintético-vs-real. Endurecida también la adopción/reconciliación para placeholders sin fecha.

---

## Hito septiembre 2026 — Temporada 2026/27 y endurecimiento post-auditoría

- **Alta de la 2026/27 con seed genérico.** Nuevo `apps/etl/src/seed-fep-competition.ts`: descubre los equipos en la fuente, crea competición + temporada (is_current) + equipos + `competition_sources`, con embudo de identidad (no crea equipos a ciegas; lo dudoso a la cola HITL) y `--force-new` para altas confirmadas a mano. 11 competiciones operando (OK Liga M/F, Plata N/S/F, Bronce N/S, Supercopas). Runbook: [runbook-alta-ligas-2026-27.md](./runbook-alta-ligas-2026-27.md).
- **Listado de competiciones por temporada** con filtro estricto por nombre de temporada (los Europeos Sub-17 de World Skate de julio 2026, con temporada 2025/26, ya no cuelan en la portada).
- **Parser de calendario y standings:** filas de bye (DESCANSO) omitidas.
- **Incidente del 26/09 (crash-loop de la API):** el salto de `nodemailer` 9→10 dejó el paquete anidado fuera de la ruta de resolución del bundle → la API no arrancaba y la web se quedó sin datos. El CI ahora **reproduce la resolución real de Node dentro de la imagen** (`scripts/verify-image-deps.mjs`, job `docker` bloqueante).
- **Auditoría Go/No-Go (27/09):** verificación completa de producto, datos, seguridad e infraestructura contra producción. Hallazgos clasificados y abiertos como issues #147–#183.

---

## Hito agosto 2026 — Entity Resolution (identidad de clubes)

Bloque completo (Fases 0→3) para separar la **identidad estable del club** de sus **secciones** (equipo = club × género × categoría × filial) y de sus **nombres de patrocinio**, y para resolver de forma robusta los equipos entrantes del scraping. As-built y operativa en [RUNBOOK_ENTITY_RESOLUTION.md](./RUNBOOK_ENTITY_RESOLUTION.md); diseño en [ARQUITECTURA_ENTITY_RESOLUTION.md](./ARQUITECTURA_ENTITY_RESOLUTION.md).

- **Fase 0 — Modelo (migración 044).** `clubs`, `sponsors`, `club_names` y `source_entity_map` (ID de fuente → entidad), más `teams.club_id`/`squad_level`. Backfill 1:1 (108 clubs) y la API/web exponen el club canónico. Aditivo; ejecutado en producción.
- **Fase 1 — Embudo determinista (migración 045).** `normalizeTeamName()` pura + `team_aliases`; el resolver pasa a resolver por `source_entity_map` (escalón 1) y por alias normalizado (escalón 2), alimentándose solo. El escalón nuevo va entre el slug y la similitud: nunca resuelve peor que antes.
- **Fase 2 — Fuzzy + cola HITL (migración 046).** Sustituye el auto-confirm ciego a 0.4 de similitud (origen del duplicado del Liceo) por fuzzy con bloqueo que **encola** lo dudoso en `resolution_queue`, más el panel de moderación `/admin/resolucion` (bandeja por impacto, resolver/descartar, aprendizaje del alias con cada clic).
- **Fase 3 — Auto-confirmación con señales.** La máquina resuelve sola sólo con similitud ≥0.95 **y** señales de dominio consistentes (género + categoría); si no, encola. Falla en cerrado (hoy no dispara en OK Liga porque resuelve por ID).
- **Métrica de salud** de la cola (`/admin/resolution-queue/stats`) y specs de diseño commiteados.

Todo validado con tests de integración contra Postgres real. Pendiente futuro: **Fase 4** (LLM en lote sobre el backlog) y el cruce **inter-fuente PT/IT**, que es lo que activa de verdad el embudo.

---

## Hito julio 2026 (19–27 jul) — Endurecimiento de plataforma tras la auditoría de arquitectura

Sprint centrado en robustez de producción, no en producto. Cierra los bloques 1 y 2 de [AUDITORIA_ARQUITECTURA_2026-07-19.md](./AUDITORIA_ARQUITECTURA_2026-07-19.md).

### Directo y datos

**Fin de los partidos fantasma "EN JUEGO".** Durante el Europeo Sub-17 (World Skate) los partidos se quedaban en directo horas después de terminar. Dos causas encadenadas: World Skate no se scrapeaba dentro del ciclo de directo (iba detrás de `cron-live` en el planificador secuencial, que lo ocupa hasta 180 min), y su estado `live` se infiere del reloj, así que sólo un scrape lo deshace. Se movió el scrape de World Skate al ciclo de 45 s (de paso, su directo gana resolución: de 5 min a 45 s) y se añadió `stale-live-watchdog.ts`, una red de seguridad **independiente del scraper** que degrada a `scheduled` lo que lleve más de 5 h en `live` y avisa a Sentry.

**Idempotencia del upsert de eventos.** El `replaceMatchEvents` hacía DELETE+INSERT, cambiando los ids en cada ciclo de 45 s; con refs posicionales sobre un acta que se reordena, el push re-notificaba cada gol continuamente. Migraciones 034/035/036: índice único parcial `(match_id, source_ref)` y refs derivadas del contenido, no de la posición.

**Actas para todas las fuentes.** Se desacopló el scraping de actas de la FEP: cuatro acoplamientos encadenados (`LIKE 'fep_match_%'`, cliente fijo, patrón de nombre con licencia federativa, early-return del ciclo) que impedían que World Skate —o cualquier fuente futura— tuviera cronología, crono o alineaciones. Registro de fuentes en `apps/scraper/src/core/sources.ts`.

### Plataforma

**Producción ejecuta JavaScript compilado.** Antes arrancaba con `npx tsx` (devDependency): sin typecheck al arrancar, transpilando en cada boot, y con `npm audit --omit=dev` auditando algo distinto de lo que corría. Ahora `scripts/build-server.mjs` empaqueta con esbuild y la imagen corre `node dist/…`.

**Imagen Docker multi-stage.** Tres etapas (deps → build → runtime). La imagen final no lleva fuentes, toolchain ni devDependencies y corre como usuario `node`. Healthchecks para api/web/etl y límites de memoria por servicio.

**Servicio `migrate` en el compose.** Corre una vez y bloquea el arranque de api/etl hasta terminar. Elimina el paso manual cuyo olvido dejaba el esquema desincronizado.

**Next 14 → 16** manteniendo React 18, y **nodemailer 8 → 9**: cierra los avisos de seguridad correspondientes.

**CI que bloquea de verdad.** Typecheck (incluidos los tests, que no son workspace npm), tests, lint, migraciones desde cero, build de la imagen con verificaciones sobre ella (sin `tsx`, sin `.ts`, no-root, entrypoints presentes), **tests de integración contra Postgres real** y **audit de dependencias bloqueante**. Este último cazó cinco `high` publicados durante el propio sprint (`fast-uri`, `sharp`, `postcss`), resueltos con `npm audit fix` + overrides.

**Tests de integración.** `tests/integration/` con Postgres real y las migraciones reales (no un emulador: el código usa índices parciales, `ON CONFLICT WHERE`, `make_interval`, `ctid`). 16 tests de `replaceMatchEvents` y `sweepStaleLive`, verificados por mutación. Detalle en la auditoría, punto 2.5.

---

## Hito junio 2026 (16–17 jun) — Multi-competición, avisos completos y robustez de cuenta

Salto de "OK Liga en directo" a **plataforma multi-competición** con un sistema de notificaciones cerrado, app instalable y cuenta sólida entre dispositivos.

### Producto (CPO)

**Cobertura de competiciones.** El directo deja de ser solo OK Liga masculina: se ingieren **todas las competiciones senior y copas de la temporada actual**, con marcadores en vivo para todas. La **OK Liga Femenina** queda unificada (liga + playoff en una sola competición, como la masculina). Las copas/campeonatos de España se modelan como rondas de playoff. En las listas de la home cada partido indica **a qué competición pertenece** (antes se asumía OK Liga masculina).

**Notificaciones, de básicas a completas.** Además de inicio/gol/final, ahora se emiten avisos de **inicio y fin de jornada**, **competición seguida** y **gol de jugador seguido**. Se añade **on/off por entidad concreta** (silenciar un equipo, liga o jugador sin dejar de seguirlo) y un **botón "enviar notificación de prueba"** para verificar permiso + suscripción + Service Worker al instante. La pantalla de Ajustes → Notificaciones se rediseñó con banner de estado del permiso, filas de navegación por tipo y subpantallas por entidad. Detalle en [NOTIFICACIONES.md](./NOTIFICACIONES.md).

**App instalable (PWA).** Botón de "instalar app" desde el navegador (`beforeinstallprompt` en Android/Chrome) con instrucciones manuales para iOS. En iOS la instalación es **requisito** para recibir Web Push.

**Favoritos que viajan de verdad.** Sincronización en la nube **write-through**: cada estrella se refleja al instante en la cuenta (no solo al hacer login), con **tombstones** para que una baja hecha sin conexión no reaparezca al reconciliar. Se unificó el estado entre la estrella, "Mis ligas", Ajustes y "Gestionar favoritos" (antes había desconexión).

**Usabilidad en competición.** Toolbar de filtros (jornada / fecha / equipo) con **estado en la URL** y exclusión mutua, estados vacíos claros, ocultación de fases de playoff vacías, y UX limpia para eliminatorias **a partido único** (se muestra el marcador real, no "1–0" de victorias). El botón "Volver" devuelve a la **página anterior exacta** (mantiene día y filtros) en vez de a la home.

**Compartir y SEO.** Imágenes **Open Graph dinámicas por partido** (escudos + marcador vía `next/og`) más una OG estática de marca. Compartir la alineación como imagen se pre-genera para que iOS no se quede "pensando".

### Plataforma (CTO)

**Modelo de datos multi-competición.** Equipos deduplicados **por referencia FEP** (`source_ref`/`alt_source_refs`), no por slug, para que un club que juega varias competiciones sea una sola entidad. `import-history.ts` admite `--only-idc=` (lista) y `--fichas`; `run-pipeline.ts` trata ciertas `idc` como playoff/copa. Operativa completa en [RUNBOOK_COMPETICIONES.md](./RUNBOOK_COMPETICIONES.md).

**Directo aislado por capas.** El cron de directo conserva su camino crítico para la OK Liga y añade una **pasada adicional aislada** para el resto de competiciones: si falla, no arrastra a la OK Liga.

**Emisor de avisos (ETL).** `push-dispatcher.ts` hace snapshot/diff de rondas y goles por ciclo y segmenta por equipo, liga y jugador; los eventos de jornada son globales. `push_subscriptions` guarda `fav_leagues`/`fav_players` (**migración 025**).

**Migraciones.** 025 (favoritos de liga/jugador en suscripciones) y 026 (fusión del playoff femenino dentro de la liga femenina, espejo de la 014).

**Robustez de cuenta.** Magic link de un solo uso endurecido contra el doble disparo del efecto de verificación (un token se consumía dos veces y daba "caducado"); `resolveUserByEmail` tolera colisiones de `device_id`; mensajes de error de Google OAuth más claros cuando el email ya existe por otro método. Derivación de temporada en runtime para no depender de `NEXT_PUBLIC_SEASON_ID` horneado vacío en build.

**Detalle visual de datos.** Normalización de mayúsculas en nombres de club (`clubName()`: conectores en minúscula, acrónimos ≤3 en mayúscula).

### Operación destacada

La BD de producción se **reconstruyó el 16/06** partiendo solo de la OK Liga vigente (histórico borrado, se vuelca aparte). Tras una reconstrucción así hay que **reaplicar todas las migraciones** (`$DC exec api npx tsx packages/db/src/migrate.ts`); omitirlo reproduce el 500 del magic link por columnas inexistentes.

### Pendiente inmediato

Prueba **end-to-end de notificaciones en directo** durante un partido real de playoff (19/21/23 junio).

---

## Hito anterior (≤11 jun 2026)

Salida a producción en `sticklive.eu`: OK Liga en directo con SSE y push básicas, histórico RFEP 1999/00→2025/26, favoritos con auth progresiva (magic link + Google OAuth), i18n en 5 idiomas, SEO base y analítica PostHog. Ver el estado de esa fecha en el historial de `ESTADO_PROYECTO.md`.
