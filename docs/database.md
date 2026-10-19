# Base de datos

*PostgreSQL 16 (la 072 exige ≥ 15: `UNIQUE NULLS NOT DISTINCT`). Contrastado con `packages/db/migrations` (74 ficheros) y el runner actual. Arquitectura general en [architecture.md](./architecture.md).*

## Rol de aplicación (mínimo privilegio, #298)

- `sticklive_app` es el rol con el que conectan **api y etl**: `SELECT/INSERT/UPDATE/DELETE` sobre todas las tablas (actuales y futuras vía `DEFAULT PRIVILEGES`), `USAGE` de secuencias y `CREATE` de esquema **sólo** para las particiones que crea el `partition-guard` (único DDL legítimo del runtime). Sin `DROP`, sin `ALTER`, sin superusuario.
- `migrate` (servicio de despliegue) sigue conectando con el **dueño del esquema** (`POSTGRES_USER`): las migraciones necesitan DDL sin límites.
- La password del rol NO vive en el repo: se fija en el servidor con `ALTER ROLE sticklive_app WITH PASSWORD '…';` y se referencia en `.env.prod` como `APP_DB_PASSWORD` (la consume el `DATABASE_URL` de api/etl en `docker-compose.prod.yml`).
- Rotación: `ALTER ROLE … PASSWORD`, actualizar `APP_DB_PASSWORD` en `.env.prod` y `$DC up -d api etl`. Rollback: restaurar el `DATABASE_URL` anterior.

## Identidad de equipo (#198, decisión)

**El modelo es `team = club × gender × age_category × squad_level`** (1=primer equipo, 2=B, 3=C; migración 044). Decisión sobre la relación filial→primer equipo:

- **Se apuesta por la fase 2 de `clubs`** (agrupación real de clubes + la UNIQUE diferida `club_id, gender, age_category, squad_level`), NO por una columna `parent_team_id`. Razón: la fila de club ya existe (`clubs`, 044) y `parent_team_id` duplicaría la relación con una segunda fuente de verdad que habría que mantener sincronizada con `split-filial-teams`.
- **Condición previa** (ya anotada en 044 y aquí): el backfill actual de clubs es 1:1 — reutiliza el slug del team como slug de club, así que agrupar "CP LAS ROZAS" / "CLUB PATIN LAS ROZAS" / "CP LAS ROZAS B" chocará al normalizar. La fase 2 necesita su plan de migración de slugs de club y una pasada HITL por los clubes multi-nombre (caso extremo conocido: CP LAS ROZAS con 10 filas). Hasta entonces la UNIQUE sigue DIFERIDA a propósito.
- **Origen del dato**: el seed deriva `squad_level` del nombre de la fuente (patrones ` B`/` II`/` 2`/` C` al final, #198) cuando no viene por flag; `split-filial-teams.ts` sigue siendo la herramienta de reparación masiva de los ya mal creados.

## Migraciones

- Ficheros SQL versionados en `packages/db/migrations/`, aplicados en orden por el runner idempotente `packages/db/src/migrate.ts` (tabla `_migrations`; re-aplicar es no-op). Comando: `npm run db:migrate`.
- Cada fichero se ejecuta como una sola transacción: si falla, se revierte entero y el runner aborta (y el despliegue no arranca api/etl). Por eso `CREATE INDEX CONCURRENTLY` no puede ir en migraciones normales — para índices sobre tablas grandes hay un procedimiento sin lock: [runbook-indices-grandes.md](./runbook-indices-grandes.md).
- El CI aplica **todas las migraciones desde cero** y las re-aplica (idempotencia) en cada push.
- Convención operativa: si una migración reescribe datos existentes, `./deploy/backup-db.sh` antes (ver [DEPLOY.md](./DEPLOY.md)).
- Últimas de peso: `043` LISTEN/NOTIFY del directo · `044–046` Entity Resolution (clubs/aliases/cola) · `047` particionado de `match_events` · `048` `import_batches` · `052` índices sobre tablas grandes · `072` fases de competición (aditiva, con backfill `legacy` re-ejecutable `backfill_legacy_phases()`; operativa en [runbook-fases-y-directo.md](./runbook-fases-y-directo.md)).

## Modelo de datos (núcleo deportivo)

```text
sports ──< competitions ──< competition_sources
                │
                └──< seasons ──< phases ──< rounds
                        │           │          │
                        │           └──────────┴──< matches >── season_teams >── teams >── clubs
                        │                            │                                    │
                        └──< standings               ├──< match_events (particionada)     └── club_names · sponsors
                                                     └──< match_lineups
teams ──< team_aliases · source_entity_map · resolution_queue
players ──< team_players
```

- **`competitions` / `seasons`** — una competición agrupa temporadas; `is_current` es única por competición (constraint).
- **`phases` (072)** — la ESTRUCTURA de una temporada: `Competition → Season → Phase → (Group) → Round → Match`. Cada fase tiene `kind` (`league` | `groups` | `knockout`), `is_placement` (no decide el título: 9.º-10.º, 5.º-8.º), `ordinal`, `name` y `resolved_by` (qué evidencia decidió el tipo: `source_rounds` / `source_title` > `declared` > `structural_rule` > `fallback`; `legacy` = backfill de 072). El "formato" de una competición no es un campo: es la secuencia de sus fases (liga + playoff, grupos + final four…). Identidad en la fuente: `(season_id, source_ref)` único (`fep_fase_3483`). Diseño: [superpowers/specs/2026-10-08-fases-y-directo-explicito-design.md](./superpowers/specs/2026-10-08-fases-y-directo-explicito-design.md).
- **`rounds`** — jornada (fases `league`/`groups`) o fase eliminatoria (fases `knockout`, con `stage` canónico: `round_of_16 | quarters | semis | final | third_place | placement`). `round_type` (`regular` / `playoff` / `cup` / `friendly`) se conserva. Identidad: `UNIQUE NULLS NOT DISTINCT (season_id, phase_id, number, round_type)` — dos fases pueden tener su "ronda 1"; para rondas sin fase, la unicidad es la de antes.
- **`teams` / `season_teams`** - un `team` es la sección de un club en una temporada (club × género × categoría × filial). La identidad estable vive en `clubs`; los nombres comerciales (patrocinio) en `club_names` con vigencia. `teams.display_name` (080) es el nombre de presentación curado desde `/admin` para títulos y UI; `NULL` = usar `teams.name`.
- **`matches`** — `home_team_id` / `away_team_id` / `season_id` son `NOT NULL` con FK: **no pueden existir partidos huérfanos** a nivel de esquema. `status` con CHECK (`scheduled|live|finished|postponed|cancelled`), `scheduled_at` nullable (jornadas sin fecha de la fuente), `scheduled_at` en timestamptz UTC. `phase_id` (pertenencia aunque no tenga ronda) y `series_game` (nº de partido de la eliminatoria: "2 CUARTOS" → 2; ida = 1, vuelta = 2) desde 072.
- **Estado del partido = lo que dice la fuente.** Solo una señal explícita lo cambia (feed en vivo, match center, acta, resultado publicado); una fuente que no informa del estado no lo toca (`status = COALESCE(nuevo, matches.status)`, regla `resolveStatusTransition` de `@sports/shared-types`). La hora programada **nunca** pone un partido en `live`.
- **`match_events`** — **particionada por `match_date`** (denormalizado desde `scheduled_at`, NOT NULL). Partición centinela `match_events_undated` debe quedar siempre vacía (`partition-guard` la vigila a diario y alerta). Identidad de evento: `(match_id, source_ref, match_date)` único parcial, con `source_ref` derivada del contenido (periodo+crono+tipo+lado).
- **`match_lineups`** — alineaciones por partido (dorsal, portero, 5 inicial, capitán, goles/asistencias).
- **`standings`** — clasificación por temporada (y grupo); único `(season_id, team_id, COALESCE(group_name,''))` con backfill de NULLs. Todavía **no** está ligada a una fase: la API la atribuye a la primera liguilla por el título de la temporada (suficiente para liga + playoff y grupos + final four; dos liguillas seguidas necesitarían `standings.phase_id`).
- **`competition_sources`** — configuración por fuente/competición (`idc`, portal, timezone). Es lo que itera el cron en producción: alta de liga = un INSERT.
- **Entity Resolution** — `source_entity_map` (ID de fuente → club o equipo, FK polimórfica), `team_aliases` (nombre normalizado → team, índice GIN de trigramas), `resolution_queue` (cola HITL). `teams.source_ref`/`alt_source_refs` coexisten con el mapa.
- **`players` / `team_players`** — jugadores y plantillas; las plantillas se reconstruyen desde las actas.

## Calidad de datos / visibilidad (migraciones 064 y 067)

- `competitions.data_quality` (064) y `seasons.data_quality` (067): `'ok'` (defecto) | `'en_revision'`.
- **Una temporada es visible ⇔ ella y su competición están en `'ok'`.** Si no, deja de ser consultable por el usuario: listados, búsqueda, selector de temporadas, endpoints de temporada (`overview`/`stats`/`standings`/`matches` → 404), ficha de partido, historial de equipo, carrera de jugador y sitemap.
- La competición actúa de **interruptor maestro**: `en_revision` oculta todo su contenido.
- El scraper/ETL **nunca** escribe estas columnas; la curación sobrevive a los upserts.
- El **emisor de push** (`apps/etl/src/push-dispatcher.ts`) también filtra por visibilidad: nunca notifica partidos, jornadas ni eventos (gol/tarjeta/falta/prórroga/final) de temporadas o competiciones ocultas.
- Curación: panel `/admin` → pestaña «Competiciones», o los endpoints `PATCH /admin/competitions/:id/quality` y `PATCH /admin/seasons/:id/quality` (cabecera `X-Admin-Token`, body `{ dataQuality }`).
- Límite: las páginas web cacheadas por ISR pueden tardar hasta ~5 min en reflejar el cambio (la API responde 404 al instante).
- **Periodo de gracia para Google (075, F1-6)**: `data_quality_changed_at` en competiciones y temporadas lo fija un trigger al cambiar `data_quality`. Durante las primeras 72 h de una ocultación, la ficha de la competición o del partido responde 5xx en vez de 404 (Google reintenta y no desindexa una revisión corta). Pasado el plazo, o si se ocultó antes de la 075 (fecha NULL), 404 como siempre. Para el usuario la ficha sigue sin datos en ambos casos.

## Bajas, fusiones y SEO (migraciones 073 y 074)

- **`entity_redirects` (073)**: `(entity_type, old_id) → new_id` para fichas públicas (`competition`, `team`, `player`, `match`). `new_id` NULL = baja sin sustituto. Un trigger `AFTER DELETE` en las cuatro tablas registra todo borrado aunque el código no lo sepa. Quien conoce al sustituto lo apunta con `recordEntityRedirect` (`mergeCompetitions`, `merge-canonical-competitions.ts`, la reversión de `split-filial-teams.ts` y `reconcileSyntheticMatches`, que redirige el placeholder sintético al partido real). `GET /redirects/:type/:id` sigue la cadena y la web responde 308 al sustituto o 404. `TRUNCATE` no dispara el trigger: un reset completo no deja rastro.
- **`competitions.top_tier` (074)**: competición de máxima categoría. Sus jugadores son los únicos que se declaran en el sitemap. Para una liga nueva de primera división basta con `UPDATE competitions SET top_tier = TRUE WHERE slug = '…'`.
- Detalle y motivo: [AUDITORIA_SEO_2026-10-16.md](./AUDITORIA_SEO_2026-10-16.md) (F1-3, F1-4 y F1-7).

## Cuenta y producto

- `users` (email opcional, `status` admin, premium via `orders`/`premium_until`) · `user_sessions` (tokens **hasheados** SHA-256, caducidad 90 días, máx. 5 por usuario) · `auth_tokens` (magic links, hasheados, single-use atómico).
- `user_favorites` (kind: team/league/player, con tombstones para sincronización multi-dispositivo) · `push_subscriptions` (endpoint, claves, `fav_teams`/`fav_leagues`/`fav_players`, `config` con **presets por entidad**: complete/key_events/results/silent).
- `orders` + `processed_stripe_events` (idempotencia del webhook) — monetización dormida tras flag.

## Operación

- `scrape_logs` (una fila por pasada de scraper, `success|partial|error`; purga diaria, retención 30 días) · `import_batches` (trazabilidad/reversibilidad de importaciones masivas) · `_migrations`.
- `match_events` — **retención DIFERIDA (#301)**: sus particiones `match_events_s20xx` se crean por temporada pero **no se purgan**, así que el dump crece con los años. Borrar eventos históricos es una **decisión de producto** (¿purgar temporadas pasadas? ¿agregar?), no una tarea de limpieza: cambia qué muestra la hemeroteca. Diferida a propósito; mientras tanto el disco se vigila con `deploy/disk-hygiene.sh` (ver [operations.md](./operations.md#disco-y-retención-301)).

## Índices calientes (los que sostienen la API)

| Índice | Sirve a |
|---|---|
| `idx_matches_season_scheduled` | calendarios por temporada y fecha |
| `idx_matches_live_partial` | `/matches/live` |
| `idx_matches_season_status_scheduled` | ventana de la home (`/matches/current`) |
| `uq_match_events_match_source_ref` | upsert idempotente de eventos (`ON CONFLICT`) |
| `idx_match_events_match (match_id, match_date)` | timeline del partido (poda de partición) |
| `idx_match_events_player` (parcial) | estadísticas de jugador |
| GIN trigram en `team_aliases` | resolución por nombre |

El CI verifica tras migrar que los 5 índices críticos existen (si falta el de eventos, el scraper de directo revienta).

## Convenciones

- Timestamps en `timestamptz` UTC; la hora local se resuelve con `competitions.timezone` / `seasons.timezone` (sedes itinerantes).
- Toda tabla de dominio lleva trazabilidad de fuente (`source_id`/`source_ref`/`source_url`, `scraped_at` donde aplica).
- No hay `ON DELETE CASCADE`: borrar un equipo con partidos está bloqueado por las FK — es deliberado (los malos datos no se limpian a ciegas; hay runbooks de fusión en el panel admin).
