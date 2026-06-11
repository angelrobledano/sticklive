# Sports Results Platform

Plataforma de resultados deportivos en tiempo real, enfocada inicialmente en hockey sobre patines.

## Estructura del monorepo

```
/
├── apps/
│   ├── scraper/        # Scrapers (Playwright + Cheerio)
│   ├── etl/            # Normalización y carga a DB
│   └── api/            # Next.js — frontend + API routes
├── packages/
│   ├── db/             # Migraciones y queries PostgreSQL
│   ├── shared-types/   # Tipos TypeScript compartidos
│   └── logger/         # Logger (pino) compartido
├── infra/
│   └── docker/         # Docker Compose
└── docs/
    └── architecture.md # Decisiones de arquitectura
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

→ [Arquitectura y decisiones técnicas](docs/architecture.md)
