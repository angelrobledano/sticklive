# Sports Results Platform

Plataforma de resultados deportivos en tiempo real, enfocada inicialmente en hockey sobre patines.

## Estructura del monorepo

```
/
├── apps/
│   ├── scraper/        # Scrapers (Playwright + Cheerio)
│   ├── etl/            # Normalización, carga a DB y crons (live + emisor push)
│   ├── api/            # Hono (Node) — REST + SSE, puerto 3000
│   └── web/            # Next.js 14 App Router — puerto 3001
├── packages/
│   ├── db/             # Migraciones y queries PostgreSQL
│   ├── shared-types/   # Tipos TypeScript compartidos
│   ├── analytics/      # Eventos de servidor (PostHog)
│   └── logger/         # Logger compartido
├── infra/
│   └── docker/         # Docker Compose
└── docs/               # Documentación (ver abajo)
```

## Arranque rápido (desarrollo)

```bash
# 1. Levantar PostgreSQL
docker compose -f infra/docker/docker-compose.dev.yml up -d

# 2. Instalar dependencias
npm install

# 3. Copiar variables de entorno
cp .env.example .env

# 4. Aplicar migraciones
psql $DATABASE_URL -f packages/db/migrations/001_initial_schema.sql

# 5. Descubrir APIs de la fuente (primer paso obligatorio)
npm run probe --workspace=apps/scraper

# 6. Ejecutar scraper de competiciones una vez
npm run start --workspace=apps/scraper -- --run-once fep_competitions
```

## Comandos útiles

```bash
# Sonda de red (descubre APIs ocultas de hockeypatines.fep.es)
npm run probe --workspace=apps/scraper

# Ejecutar un scraper específico
npm run start --workspace=apps/scraper -- --run-once fep_competitions

# Typecheck todo el monorepo
npm run typecheck

# Tests
npm run test
```

## Documentación

- [Estado del proyecto](docs/ESTADO_PROYECTO.md) — qué funciona hoy, de punta a punta.
- [Changelog](docs/CHANGELOG.md) — historial de hitos de producto y plataforma.
- [Notificaciones push](docs/NOTIFICACIONES.md) — cuándo y cómo se envían los avisos.
- [Runbook de competiciones](docs/RUNBOOK_COMPETICIONES.md) — alta y gestión de competiciones en producción.
- [Despliegue](docs/DEPLOY.md) — procedimiento de deploy, migraciones y túnel a la BD.
- [Arquitectura y decisiones técnicas](docs/architecture.md) — racional de diseño original.
