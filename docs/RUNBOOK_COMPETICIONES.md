# Runbook — alta y gestión de competiciones

*Actualizado: 17 de junio de 2026*
*Nota (27/09/2026): para altas de la **temporada en curso** usa el seed genérico `apps/etl/src/seed-fep-competition.ts` (embudo de identidad + cola HITL) — paso a paso en [runbook-alta-ligas-2026-27.md](./runbook-alta-ligas-2026-27.md). Este runbook sigue siendo la referencia del modelo de datos y de las importaciones históricas por `idc`.*

Cómo añadir una competición nueva, fusionar liga + playoff, y los errores que cuestan una tarde si no los conoces. Pensado para ejecutarse contra producción (Hetzner + Docker Compose en `/opt/sticklive`).

---

## Conceptos previos

- **`idc`**: identificador de competición en la fuente FEP (`sidgad`/`rfep`). Cada competición-temporada tiene el suyo. El histórico se importa por lista de `idc`.
- **`temp_39`**: temporada actual 2025/26 en la fuente. `is_current` se marca cuando `comp.tempId === '39'`.
- **Modelo de datos**: `competitions → seasons (is_current única por competición) → rounds (round_type: regular/playoff/cup/friendly) → matches`. La competición de un partido se deriva vía su `season`.
- **Una competición = liga + playoff**: la OK Liga (masc. y fem.) es **una sola competición**; los partidos de playoff son `rounds` con `round_type='playoff'` dentro de la misma temporada. Las copas/campeonatos de España se modelan también como rondas de playoff. Una **Final Four** (Supercopa) se declara con `competition_sources.external_ids.format='final_four'`: sus rondas se crean como `round_type='playoff'` con numeración canónica **Semifinal=1 / Final=2** y la web la pinta como cuadro (Semifinal x2 → Final), nunca como liga.

---

## Decisión de modelo: deduplicar equipos POR REFERENCIA, no por slug

Un mismo club juega varias competiciones a la vez (p. ej. Barça en OK Liga **y** en Campeonato de España). Para que sea **una sola entidad** y los favoritos/escudos funcionen en todas:

- Los equipos se resuelven por `source_ref` / `alt_source_refs` (la ref FEP), **no** por `slug`.
- Si la ref ya existe → se reutiliza el equipo, añadiendo la nueva ref a `alt_source_refs` si difiere.
- Si no hay match → se crea equipo nuevo con **slug único** (sufijo de género/ref para evitar colisiones de `UNIQUE(sport_id, slug)`).

Esto lo gestiona `import-history.ts` con la resolución *dedupe-by-ref*. No volver a deduplicar por nombre/slug: dos clubes distintos pueden compartir nombre corto.

---

## Alta de una competición nueva (temporada actual)

Desde el servidor, con el alias de Compose cargado:

```bash
cd /opt/sticklive
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
# Proteger los scripts modificados en el server antes de cualquier git pull:
git checkout -- deploy/backup-db.sh deploy/restore-sports-dump.sh
git pull
```

1. **Importar el catálogo + calendario + clasificación + actas** de una o varias `idc`:

   ```bash
   # Desde el PC, con el túnel SSH abierto (ver docs/DEPLOY.md).
   # NO va en el contenedor: import-history lee apps/scraper/logs/fep-catalog.json
   # y lanza subprocesos, y la imagen de producción ya no lleva ni el catálogo
   # ni `tsx`. Además es un trabajo largo que conviene hacer desde IP residencial.
   npx tsx apps/etl/src/import-history.ts --only-idc=3150,3481,3484 --fichas
   ```

   - `--only-idc=` acepta **lista separada por comas**.
   - `--fichas` añade `fichas-pendientes` al bucle de scrape, para volcar actas (alineaciones + jugadores) de los partidos ya jugados.
   - `is_current` se pone solo si la temporada es la `39`.

2. **Lanzar el pipeline** para crear rondas de playoff/copa y consolidar:

   ```bash
   $DC exec etl node dist/apps/etl/src/run-pipeline.js
   ```

   - `PLAYOFF_IDCS_PIPELINE = ['3481','3484']` → esas `idc` se tratan como rondas de playoff.
   - Las `idc` de copa (CUP_IDCS) generan rondas de playoff cuyo número/nombre sale del `roundRef` del calendario. Con `format='bracket'` o `'final_four'` en `competition_sources.external_ids` se hace sin la lista hardcodeada; `final_four` usa Semifinal=1 / Final=2.

3. **Verificar** en la web que aparecen los partidos, que el equipo compartido no se ha duplicado, y que la etiqueta de competición es correcta en la home.

---

## ⚠️ Gotcha que rompe todo: `FEP_SOURCE_ID`

Si el `FEP_SOURCE_ID` queda como **UUID placeholder** (no el real de la fila `sources`), los scrapers escriben con un `source_id` que no existe y **toda la importación queda huérfana / falla en cascada**. Antes de importar, confirmar que el `source_id` real está resuelto (helper `requireFepSourceId`, no fallback placeholder). Es el primer sitio donde mirar si "no aparece nada" tras un import aparentemente correcto.

---

## Fusionar liga + playoff femenino (patrón migración 026)

La OK Liga Femenina llegó como dos competiciones separadas (`ok-liga-femenina` y `playoff-ok-liga-femenina`). Para que sea una sola, igual que la masculina, la **migración 026** mueve los partidos del playoff a la temporada de la liga femenina como rondas `round_type='playoff'`. Es el espejo de la 014 (que hizo lo mismo para la masculina).

Si en el futuro otra competición llega partida igual, **clonar la 026** cambiando los slugs de origen/destino. No hace falta tocar código de la app: el modelo ya muestra liga+playoff como pestañas de una misma competición.

---

## Reconstrucción de la BD desde cero (lo que se hizo el 16/06)

La BD de producción se vació y se reconstruyó solo con la OK Liga vigente (`idc` 3150 + 3481), borrando el histórico. Tras un vaciado así:

1. **Reaplicar TODAS las migraciones** (el esquema se recrea, pero el runner es idempotente):

   ```bash
   $DC run --rm migrate
   ```

   En un `up` normal esto ya lo hace solo el servicio `migrate`; el comando de
   arriba es para forzarlo suelto tras un vaciado. Saltárselo provoca errores
   como `column "session_expires_at" does not exist` (migraciones 023/024 sin
   aplicar) o el magic link devolviendo 500.

2. **Seed + import + pipeline** de las competiciones deseadas (secciones anteriores).

3. El histórico multianual se vuelca **aparte** (pg_dump local → restore), no se mezcla en esta reconstrucción.

---

## Directo multi-competición

El cron de directo (`cron-live.ts`) mantiene su camino crítico para la OK Liga y añade una **pasada adicional aislada** (`activeSecondarySeasons` + `scrapeSeasonScores`) que actualiza marcadores de **todas las competiciones senior y copas de la temporada en curso**. Es aditiva: si esa pasada falla, la OK Liga sigue actualizándose. Los avisos push se segmentan por equipo/liga/jugador favorito (ver [NOTIFICACIONES.md](./NOTIFICACIONES.md)).

---

## Scraping masivo seguro: ciclo con staging (A4)

Todo scraping masivo (re-scrapes, volcados, `import-*`, backfills) se hace primero contra una BD de **staging**, se valida, y solo lo limpio se **promociona** a prod. Así el dato en bruto nunca toca producción. Diseño completo en [A4_STAGING_SCRAPING.md](./A4_STAGING_SCRAPING.md).

El ciclo, con el túnel SSH abierto y `PGPASSWORD` en el entorno:

1. **Sembrar staging desde prod** (en el servidor). Recrea `sports_staging` como copia fresca de prod (mismos UUID), así la resolución de refs y el dedup se comportan igual que prod:

   ```bash
   cd /opt/sticklive && bash deploy/seed-staging.sh
   ```

2. **Scrapear/importar contra staging** (desde el PC). Igual que siempre, pero con `DATABASE_URL` apuntando a `sports_staging` (mismo túnel, solo cambia el nombre de BD):

   ```bash
   export DATABASE_URL='postgresql://sports_user@localhost:5432/sports_staging'
   npx tsx apps/etl/src/import-history.ts --only-idc=… --fichas
   ```

3. **Validar** el lote en staging. Veredicto PASA/FALLA; sale con exit≠0 si el dato no es promocionable:

   ```bash
   cd apps/etl
   npx tsx src/validate-staging.ts --batch <label>   # o sin --batch para auditar todo staging
   ```

4. **Promocionar** a prod solo si validó. Dry-run por defecto; escribe con `--commit`. Re-valida las guardas antes de tocar prod, copia en una transacción con `ON CONFLICT DO NOTHING` (no sobrescribe nativos) y es idempotente:

   ```bash
   export STAGING_URL='postgresql://sports_user@localhost:5432/sports_staging'
   export PROD_URL='postgresql://sports_user@localhost:5432/sports_results'
   npx tsx src/promote-to-prod.ts --batch <label>            # dry-run: cuenta
   npx tsx src/promote-to-prod.ts --batch <label> --commit   # promueve
   ```

Notas: staging es **desechable** — se recrea en cada corrida y nunca deriva de prod; si el disco aprieta, `DROP DATABASE sports_staging` entre corridas libera el espacio (el seed avisa del uso de disco). **Revertir** una promoción en prod: `DELETE FROM matches WHERE import_batch_id = '<id>';`. **No** hace falta reaplicar migraciones en staging: el seed trae el esquema completo del dump.

---

## Particionado de `match_events` (automático, #101)

No hay paso manual al dar de alta una temporada. El `partition-guard` del
scheduler (diario, `deploy/etl-scheduler.sh`) hace dos cosas:

1. **Asegura las particiones** de la temporada actual y las 2 siguientes
   (`CREATE TABLE IF NOT EXISTS match_events_sAAAA PARTITION OF match_events …`),
   así que la del año que viene existe antes de empezar. La migración 047 ya creó
   hasta 2035/36; el guard mantiene el árbol al día sin depender de nadie.
2. **Avisa a Sentry** si `match_events_undated` —la partición centinela de
   partidos sin `scheduled_at`— recibe filas: en régimen normal debe estar vacía.

Forzarlo a mano: `node dist/apps/etl/src/partition-guard.js`.
Ajuste: `PARTITION_SEASONS_AHEAD` (defecto 2).

## Checklist rápido

- [ ] `git checkout --` de los scripts del server antes de `git pull`.
- [ ] `FEP_SOURCE_ID` real resuelto (no placeholder).
- [ ] `import-history --only-idc=… [--fichas]`.
- [ ] `run-pipeline` para rondas de playoff/copa.
- [ ] Migraciones aplicadas si se reconstruyó la BD.
- [ ] Verificación en web: partidos visibles, equipo compartido no duplicado, etiqueta de competición correcta.
- [ ] Scraping masivo: ciclo staging (sembrar → scrapear(staging) → validate-staging → promote-to-prod --commit), nunca directo a prod.

---

## Recuperar fechas y temporadas del histórico (enrich · A5)

El volcado dejó el archivo en la temporada colapsada `'Histórico'` con `scheduled_at` NULL. Este ciclo recupera la **fecha** y la **temporada real** de una competición-temporada, de forma segura: se scrapea a staging, se valida, y solo entonces se aplica a prod con `enrich-promote` — la ÚNICA operación que escribe sobre filas nativas de prod (solo `scheduled_at` + `season_id`, nunca marcador/equipos). Diseño en [A5_ENRICH_PROMOTE.md](./A5_ENRICH_PROMOTE.md).

**Requisito previo:** migración `049` aplicada en staging Y prod (`$DC run --rm migrate`). Sin ella, `kind='enrich'` falla el CHECK.

Ciclo (desde el portátil, túnel SSH abierto, `PGPASSWORD` puesto — comillas simples en PowerShell):

0. **Re-sembrar staging** fresco de prod (en el servidor):

   ```bash
   cd /opt/sticklive && bash deploy/seed-staging.sh
   ```

1. **Enrich-scrape a staging** — mueve los partidos de `'Histórico'` a su temporada real con fecha, bajo un lote `kind='enrich'`. `DATABASE_URL` apunta a `sports_staging`:

   ```powershell
   $env:PGPASSWORD='<POSTGRES_PASSWORD>'
   $env:DATABASE_URL='postgresql://sports_user@localhost:5432/sports_staging'
   npx tsx apps/etl/src/import-history.ts --only-idc=<idc> --run --enrich
   ```

   Apunta el **label** del lote (`enrich-<idc>-...`).

2. **Validar** (staging vs prod). Desde `apps/etl`:

   ```powershell
   $env:STAGING_URL='postgresql://sports_user@localhost:5432/sports_staging'
   $env:PROD_URL='postgresql://sports_user@localhost:5432/sports_results'
   npx tsx src/validate-enrich.ts --batch '<label>'
   ```

   Debe dar **PASA**. Si FALLA, para y revisa (no se promociona nada).

3. **Promover** — dry-run y luego commit:

   ```powershell
   npx tsx src/enrich-promote.ts --batch '<label>'            # dry-run: cuenta lo que se movería
   npx tsx src/enrich-promote.ts --batch '<label>' --commit   # UPDATE transaccional en prod
   ```

4. **Verificar** en la web: la ficha de esos partidos muestra fecha y la temporada real aparece poblada.

**Revertir** (si algo no cuadra): restaura `season_id`/`scheduled_at` anteriores desde `enrich_changes` y marca el lote `reverted`.

```powershell
npx tsx src/enrich-promote.ts --batch '<label>' --revert --commit
```

**Qué toca y qué no:** enrich SOLO cambia `scheduled_at` + `season_id` de partidos que en prod siguen en `'Histórico'`. Marcador, equipos, estado y `source_ref` quedan intactos (prod manda). Es idempotente (re-ejecutar no re-mueve) y reversible al valor exacto.

### Checklist enrich

- [ ] Migración `049` aplicada (staging + prod).
- [ ] `seed-staging.sh` fresco.
- [ ] `import-history --only-idc=<idc> --run --enrich` → label del lote.
- [ ] `validate-enrich --batch <label>` = PASA.
- [ ] `enrich-promote --batch <label>` dry-run revisado → `--commit`.
- [ ] Verificación en web (fecha + temporada).
