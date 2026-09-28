# Pipeline de datos — Scraper + ETL

*Contrastado con el código actual (septiembre 2026). Arquitectura general en [architecture.md](./architecture.md); operación y alertas en [operations.md](./operations.md).*

## Fuentes

| Fuente | Portal | Qué se extrae |
|---|---|---|
| FEP (RFEP) | `hockeypatines.fep.es` (plataforma sidgad, prefijo `rfep`) | Calendarios, clasificaciones, marcadores en vivo, actas (alineaciones + eventos), catálogo de competiciones |
| World Skate Europe | `wse.sidgad.com` (prefijo `worldskate`) | Mismo tipo de datos para torneos europeos (grupos + eliminatorias) |

Ambas son **la misma plataforma sidgad** servida como instancias distintas: el cliente (`apps/scraper/src/scrapers/fep/sidgad-client.ts`) se parametriza por portal (`SIDGAD_PORTAL`). Los endpoints reales no son HTML: son **APIs JSON internas** de sidgad que se descubrieron interceptando XHR con Playwright durante la fase de exploración (las rutas y payloads están codificados en `sidgad-client.ts`).

## Extracción (apps/scraper)

- **Cliente HTTP** (`sidgad-client.ts`): 3 reintentos con backoff lineal (2 s), timeout 30 s, los 404 no se reintentan. `SCRAPER_REQUEST_TIMEOUT_MS`, `SCRAPER_RETRY_DELAY_MS`, `SCRAPER_USER_AGENT` ajustan el comportamiento.
- **Scrapers** (registro y entradas en `apps/scraper/src/index.ts`, ejecución individual con `--run-once <nombre>`):
  - `fep-calendar` / `fep-standings` — calendario y clasificación por `idc` (competición en la fuente); soportan grupos y filas de bye (DESCANSO).
  - `fep-matches` — feed **global** de marcadores (`rfep_mc_1.php`): un POST devuelve todos los partidos en juego/del día de todas las competiciones.
  - `fep-ficha` — el acta: eventos con instante de juego (crono 25:00 → minuto transcurrido), alineaciones (dorsal, portero, 5 inicial, capitán), cuerpo técnico por rol y faltas de equipo. La falta directa marcada/fallada se infiere cruzando el instante del lanzamiento con los goles.
  - `worldskate` — marcadores y calendario WSE (estado live inferido por reloj, caducado a las 3 h).
- **Playwright** se usa para sesionar contra sidgad y cazar las APIs; Cheerio para lo HTML. Las zonas horarias se convierten sin dependencias (`eu-timezone.ts`, DST europeo, zona por competición según `competitions.timezone`).

## Carga (apps/etl)

- **Transformers** (`src/transformers/`): normalización de nombres, slugify, transformación de partidos/equipos/competiciones a tipos de BD. Testeados.
- **Identidad e idempotencia** (lo que hace el pipeline re-ejecutable):
  - Partidos: upsert por `source_ref` (índice único parcial; `ON CONFLICT` no toca `season_id` de partidos ya existentes salvo flag de enriquecimiento).
  - Eventos: `source_ref` **derivada del contenido** (periodo + crono + tipo + lado) dentro de `(match_id, source_ref, match_date)` — re-scrapear un acta no cambia ids ni re-dispara push.
  - Clasificaciones: único `(season_id, team_id, COALESCE(group_name,''))`; escritura transaccional **por grupo** (o falla el grupo entero).
  - Los "partidos sintéticos" creados antes de conocer al equipo real se **adoptan** cuando llega el dato real (sin duplicar); los playoffs tienen guardia anti-fantasma.
- **Resolución de entidades** (`ref-resolver.ts`, `entity-resolution.ts`): cascada con corte temprano `source_entity_map` (ID de fuente, determinista) → `team_aliases` (nombre normalizado) → slug → fuzzy con bloqueo (solo auto-confirma con similitud ≥0.95 y señales de género/categoría) → cola HITL. Detalle as-built: [RUNBOOK_ENTITY_RESOLUTION.md](./RUNBOOK_ENTITY_RESOLUTION.md).
- **`run-pipeline.ts`** — entidades: `calendar`, `standings`, `matches`, `ficha`, `fichas-pendientes`, `refichas` (re-procesar actas), `download-logos`, `all`. Con `COMPETITION_SOURCES_DRIVEN=1` (producción), calendar/standings/fichas-pendientes iteran todas las competiciones activas de `competition_sources`; sin el flag, modo single con `--season-id`/`--idc`.
- **Escudos** (`download-logos`, `normalize-logos`): los PNG se normalizan con `sharp` — se rellena la transparencia en blanco, se recorta el borde sobrante, se añade margen uniforme y se reduce a 512×512 (`logo-normalize.ts`, idempotente). La pasada completa sobre el volumen se lanza con `node dist/apps/etl/src/normalize-logos.js`. El escudo servido por `/teams/:id/logo` es siempre opaco y de tamaño uniforme.
- **`cron-live.ts`** — el directo. Cada 5 min el scheduler lo lanza; si hay partidos en juego o a menos de 2 h, entra en bucle propio de **45 s** (máx. 180 min) que hace: marcadores FEP (1 POST global) + World Skate + fichas de los partidos en juego (concurrencia 3) + diffs de push + watchdog de zombis. Al terminar, marca `finished` y cierra el bucle.

## Deduplicación de partidos y competiciones

- Una competición = una fila en `competitions`; liga y playoff comparten temporada (playoff como `rounds` con `round_type='playoff'`); copas y supercopas se modelan como rondas de playoff. Ver modelo en [RUNBOOK_COMPETICIONES.md](./RUNBOOK_COMPETICIONES.md).
- El alta de competiciones es **data-driven**: `seed-fep-competition.ts` descubre equipos en la fuente y crea competición + temporada 2026/27 (is_current) + equipos + fila en `competition_sources`. Dry-run por defecto, `--write` para escribir. Paso a paso: [runbook-alta-ligas-2026-27.md](./runbook-alta-ligas-2026-27.md).
- Importaciones históricas masivas (`import-history`, `import-federations`, volcado v1) se etiquetan con `import_batches` para trazabilidad y reversibilidad; el ciclo seguro staging→promoción está descrito en [A4_STAGING_SCRAPING.md](./A4_STAGING_SCRAPING.md) y [A5_ENRICH_PROMOTE.md](./A5_ENRICH_PROMOTE.md).

## Errores, retries y trazabilidad

- Un fallo de un partido/acta no tumba el lote (try/catch por ítem); cada pasada registra en `scrape_logs` con estado `success | partial | error` (purga diaria, retención 30 días).
- `statement_timeout` de 15 s en el pool; transacciones en standings y actas.
- `flock` obligatorio en el scheduler y en ejecuciones manuales: nunca dos pipelines de scraping a la vez.
- **Alertas** (Sentry; `SENTRY_DSN` obligatorio en producción para que existan):
  - **Sentry Cron Monitor** del directo: latido por ciclo; si el scheduler/contenedor muere, avisa en ~10 min.
  - Feed de marcadores con 0 partidos tras 3 ciclos consecutivos (fuente caída o cambiada) → alerta.
  - `scrape-health-watch` (diaria): scraper clave parado >26 h, `success` con 0 filas, o scraper esperado ausente.
  - `stale-live-watchdog` (en cada ciclo): partidos >5 h en `live` se degradan a `scheduled` y avisan.
  - `partition-guard` (diaria): crea particiones futuras y alerta si el centinela `match_events_undated` recibe filas.
- **Modo `refichas`**: re-procesa actas ya importadas para recuperar crono exacto o reprocesar con un parser mejorado, sin re-scrapear el calendario.

## Limitaciones y riesgos conocidos

- El feed global de marcadores + el fallback de temporada puede insertar un partido no visto aún en la competición equivocada (guard pendiente — issue #151).
- Si sidgad cambia el layout del acta, el parser puede devolver 0 eventos; la guardia que impide el borrado de la cronología está pendiente (issue #149) — hoy existe el `scrape-health-watch` como red, pero no cubre la ficha.
- La API pinta `live` cualquier partido no-terminal con hora pasada, anulando de facto al watchdog en la ficha (issue #150).
- Celdas no numéricas en la tabla de clasificación se convierten en 0 en silencio; un cambio de orden de columnas produciría una clasificación "válida" con ceros (detección vía `scrape-health-watch`, sin guard específica).
- El histórico importado v1 trae solo marcadores (sin eventos ni fechas para la mayoría); recuperación incremental vía enrich-promote (A5).
- Errores de parseo por fila se registran en logs pero no en `scrape_logs` (un fallo parcial del 50 % de filas no altera el estado del scrape).
