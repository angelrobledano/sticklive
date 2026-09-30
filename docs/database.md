# Base de datos

*PostgreSQL 16. Contrastado con `packages/db/migrations` (62 ficheros) y el runner actual. Arquitectura general en [architecture.md](./architecture.md).*

## Rol de aplicación (mínimo privilegio, #298)

- `sticklive_app` es el rol con el que conectan **api y etl**: `SELECT/INSERT/UPDATE/DELETE` sobre todas las tablas (actuales y futuras vía `DEFAULT PRIVILEGES`), `USAGE` de secuencias y `CREATE` de esquema **sólo** para las particiones que crea el `partition-guard` (único DDL legítimo del runtime). Sin `DROP`, sin `ALTER`, sin superusuario.
- `migrate` (servicio de despliegue) sigue conectando con el **dueño del esquema** (`POSTGRES_USER`): las migraciones necesitan DDL sin límites.
- La password del rol NO vive en el repo: se fija en el servidor con `ALTER ROLE sticklive_app WITH PASSWORD '…';` y se referencia en `.env.prod` como `APP_DB_PASSWORD` (la consume el `DATABASE_URL` de api/etl en `docker-compose.prod.yml`).
- Rotación: `ALTER ROLE … PASSWORD`, actualizar `APP_DB_PASSWORD` en `.env.prod` y `$DC up -d api etl`. Rollback: restaurar el `DATABASE_URL` anterior.

## Migraciones

- Ficheros SQL versionados en `packages/db/migrations/`, aplicados en orden por el runner idempotente `packages/db/src/migrate.ts` (tabla `_migrations`; re-aplicar es no-op). Comando: `npm run db:migrate`.
- Cada fichero se ejecuta como una sola transacción: si falla, se revierte entero y el runner aborta (y el despliegue no arranca api/etl). Por eso `CREATE INDEX CONCURRENTLY` no puede ir en migraciones normales — para índices sobre tablas grandes hay un procedimiento sin lock: [runbook-indices-grandes.md](./runbook-indices-grandes.md).
- El CI aplica **todas las migraciones desde cero** y las re-aplica (idempotencia) en cada push.
- Convención operativa: si una migración reescribe datos existentes, `./deploy/backup-db.sh` antes (ver [DEPLOY.md](./DEPLOY.md)).
- Últimas de peso: `043` LISTEN/NOTIFY del directo · `044–046` Entity Resolution (clubs/aliases/cola) · `047` particionado de `match_events` · `048` `import_batches` · `052` índices sobre tablas grandes.

## Modelo de datos (núcleo deportivo)

```text
sports ──< competitions ──< competition_sources
                │
                └──< seasons ──< rounds
                        │           │
                        │           └──< matches >── season_teams >── teams >── clubs
                        │                │                                    │
                        └──< standings   ├──< match_events (particionada)     └── club_names · sponsors
                                         └──< match_lineups
teams ──< team_aliases · source_entity_map · resolution_queue
players ──< team_players
```

- **`competitions` / `seasons` / `rounds`** — una competición agrupa temporadas; `is_current` es única por competición (constraint). `rounds` distingue `regular` / `playoff` / `cup` / `friendly`; liga y playoff comparten temporada, y las copas se modelan como rondas.
- **`teams` / `season_teams`** — un `team` es la sección de un club en una temporada (club × género × categoría × filial). La identidad estable vive en `clubs`; los nombres comerciales (patrocinio) en `club_names` con vigencia.
- **`matches`** — `home_team_id` / `away_team_id` / `season_id` son `NOT NULL` con FK: **no pueden existir partidos huérfanos** a nivel de esquema. `status` con CHECK (`scheduled|live|finished|postponed|cancelled`), `scheduled_at` nullable (jornadas sin fecha de la fuente), `scheduled_at` en timestamptz UTC.
- **`match_events`** — **particionada por `match_date`** (denormalizado desde `scheduled_at`, NOT NULL). Partición centinela `match_events_undated` debe quedar siempre vacía (`partition-guard` la vigila a diario y alerta). Identidad de evento: `(match_id, source_ref, match_date)` único parcial, con `source_ref` derivada del contenido (periodo+crono+tipo+lado).
- **`match_lineups`** — alineaciones por partido (dorsal, portero, 5 inicial, capitán, goles/asistencias).
- **`standings`** — clasificación por temporada (y grupo); único `(season_id, team_id, COALESCE(group_name,''))` con backfill de NULLs.
- **`competition_sources`** — configuración por fuente/competición (`idc`, portal, timezone). Es lo que itera el cron en producción: alta de liga = un INSERT.
- **Entity Resolution** — `source_entity_map` (ID de fuente → club o equipo, FK polimórfica), `team_aliases` (nombre normalizado → team, índice GIN de trigramas), `resolution_queue` (cola HITL). `teams.source_ref`/`alt_source_refs` coexisten con el mapa.
- **`players` / `team_players`** — jugadores y plantillas; las plantillas se reconstruyen desde las actas.

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
