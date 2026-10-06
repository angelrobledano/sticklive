# Stick Live — resultados de hockey sobre patines en directo

Plataforma de resultados, clasificaciones y directo de hockey sobre patines (fuente principal: la FEP vía sidgad; World Skate Europe como segunda fuente), desplegada y pública en **https://sticklive.eu**. En producción desde junio de 2026.

## Arquitectura (la real)

```text
Fuentes oficiales (sidgad/FEP + wse.sidgad.com)
        │  scraper: Playwright + Cheerio, APIs internas de sidgad
        ▼
   apps/scraper          extracción (FEP, WSE)
        │
        ▼
   apps/etl              normalización, resolución de entidades,
        │                upserts idempotentes, crons (directo, calendario,
        │                clasificaciones, actas) y emisor de push
        ▼
   PostgreSQL (packages/db)   53 migraciones versionadas
        │
        ▼
   apps/api  (Hono)      REST + SSE del directo, auth, push, admin  :3000
        │
        ├── apps/mobile (Expo SDK 57, Android)  la MISMA API (REST + SSE,
        │                Bearer) y push nativo vía Expo Push → FCM
        ▼
   apps/web  (Next.js 16, App Router)  mobile-first, PWA, i18n ×5  :3001
        │
        ▼
      Usuario            Caddy (HTTPS) delante en producción
```

- **Directo (SSE):** el ETL escribe en la BD → triggers `NOTIFY` → la API refresca un poller por partido y hace fan-out a los clientes SSE (con polling de respaldo en la web).
- **Notificaciones push:** el ETL compara el estado antes/después de cada ciclo y envía Web Push (VAPID) según preferencias por equipo/liga/jugador. Detalle: [docs/NOTIFICACIONES.md](docs/NOTIFICACIONES.md).

## Estructura del repositorio

```text
apps/
  scraper/   Scrapers (FEP y World Skate, sobre sidgad)
  etl/       Carga a BD, crons de directo, emisor de push, seeds de competiciones
  api/       API Hono (REST + SSE + auth + admin + push + pagos)
  web/       Frontend Next.js (App Router, i18n propio, PWA)
  mobile/    App Android con Expo (SDK 57): paridad de la web + push nativo; docs/app.md
packages/
  db/        Cliente pg + migraciones SQL + queries
  shared-types/   Tipos TS compartidos
  analytics/ PostHog en servidor
  logger/    Logging compartido
deploy/      Dockerfile de producción, Caddyfile, scheduler, backup/restore
infra/docker/ Compose de desarrollo (solo PostgreSQL)
scripts/     Empaquetado build-server.mjs y verificación de imagen
tests/integration/  Tests de integración contra Postgres real
docs/        Documentación (índice abajo)
```

## Desarrollo local

Requisitos: **Node ≥ 20** (CI usa 22), **Docker** para PostgreSQL 16.

```bash
# 1. PostgreSQL (el resto de servicios se levantan con npm)
docker compose -f infra/docker/docker-compose.yml \
               -f infra/docker/docker-compose.dev.yml up -d postgres

# 2. Instalar y configurar
npm install
cp .env.example .env          # DATABASE_URL apunta a localhost:5432

# 3. Migraciones (runner idempotente, aplica todas las de packages/db/migrations)
npm run db:migrate

# 4. Todo el monorepo en desarrollo (turbo): api :3000, web :3001, scraper
npm run dev
```

Servicios por separado: `npm run dev --workspace=apps/web`, `npm run dev --workspace=apps/api`, `npm run dev --workspace=apps/scraper`.

### Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Turbo dev (api, web, scraper) |
| `npm run build` | Build de todos los workspaces |
| `npm run typecheck` | TypeScript en todo el monorepo (debe estar en verde) |
| `npm run lint` | ESLint (bloqueante en CI, repo a cero avisos) |
| `npm run test` | Tests unitarios (vitest) |
| `npm run test:integration:docker` | Tests de integración contra Postgres real en Docker |
| `npm run db:migrate` | Aplica migraciones de `packages/db/migrations` |
| `npm run scraper:run -- --run-once <scraper>` | Ejecuta un scraper una vez (p. ej. `worldskate`, `fep_competitions`; registro en `apps/scraper/src/index.ts`) |
| `npm run etl:run` | Ejecuta el ETL (pipeline/crons; ver `apps/etl/src`) |

El scraping en producción lo orquesta `deploy/etl-scheduler.sh` (directo cada 5 min, calendario+clasificación cada hora, actas/purgas diarias); en desarrollo se ejecuta a mano con los comandos de arriba.

## Base de datos

PostgreSQL 16. Migraciones SQL versionadas en `packages/db/migrations` (53), aplicadas por un runner idempotente con tabla `_migrations` (`npm run db:migrate`). Arquitectura de datos, tablas clave, constraints y convenciones: **[docs/database.md](docs/database.md)**.

Nota: no hay seed de desarrollo. El alta de competiciones reales se hace contra la fuente con `apps/etl/src/seed-fep-competition.ts` (ver [docs/RUNBOOK_COMPETICIONES.md](docs/RUNBOOK_COMPETICIONES.md)).

## Testing

Vitest en dos capas: **unitarios** (`apps/*/src/**/*.test.ts`, sin BD) y **de integración** (`tests/integration/`, contra Postgres 16 real con las migraciones reales — el código usa índices parciales, `ON CONFLICT WHERE` y particionado que un emulador no soporta). El CI (`#quality`, `#migrations`, `#integration`, `#docker`) ejecuta typecheck, lint, tests, migraciones desde cero, `npm audit --omit=dev --audit-level=high` y la construcción de la imagen de producción. **Antes de mergear a `main` todo eso debe estar verde.**

## Deployment y producción

Producción: VPS Hetzner con `docker-compose.prod.yml` (postgres, migrate, api, web, caddy, etl), HTTPS automático con Caddy para `sticklive.eu`, migraciones automáticas al levantar, backups diarios y alertas por Sentry. Procedimiento de despliegue paso a paso: **[docs/DEPLOY.md](docs/DEPLOY.md)**. Operación (cómo saber si algo falla, logs, recuperación): **[docs/operations.md](docs/operations.md)**.

## Variables de entorno

La referencia es **`.env.example`** (desarrollo) y **`.env.prod.example`** (producción), comentadas y contrastadas con el código. Secretos reales solo en `/opt/sticklive/.env.prod` del VPS.

## Documentación

| Documento | Contenido |
|---|---|
| [docs/ESTADO_PROYECTO.md](docs/ESTADO_PROYECTO.md) | Qué funciona hoy, de punta a punta |
| [docs/architecture.md](docs/architecture.md) | Arquitectura, flujo de datos, entidades, decisiones |
| [docs/pipeline-datos.md](docs/pipeline-datos.md) | Scraper + ETL: fuentes, parsing, dedup, resolución de entidades, limitaciones |
| [docs/database.md](docs/database.md) | Arquitectura de datos, tablas, constraints, migraciones |
| [docs/api.md](docs/api.md) | Endpoints REST/SSE reales |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Despliegue en el VPS |
| [docs/operations.md](docs/operations.md) | Operación: crons, logs, alertas, recuperación |
| [docs/dr.md](docs/dr.md) | Disaster recovery: reconstrucción completa del VPS |
| [docs/RUNBOOK_COMPETICIONES.md](docs/RUNBOOK_COMPETICIONES.md) | Alta y gestión de competiciones |
| [docs/RUNBOOK_ENTITY_RESOLUTION.md](docs/RUNBOOK_ENTITY_RESOLUTION.md) | Entity Resolution as-built |
| [docs/NOTIFICACIONES.md](docs/NOTIFICACIONES.md) | Cuándo y cómo se envían los push |
| [docs/TRACKING_POSTHOG.md](docs/TRACKING_POSTHOG.md) | Qué se mide y dónde verlo |
| [docs/app.md](docs/app.md) | App móvil Android (Expo): sesión, push, i18n, EAS y checklist de release |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Historial de hitos |
