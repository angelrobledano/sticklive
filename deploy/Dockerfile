# ============================================================
# Imagen única del monorepo Stick Live.
# Se construye una vez y cada servicio (api, web, etl) arranca
# con un command distinto en docker-compose.prod.yml.
# ============================================================
FROM node:22-bookworm-slim

WORKDIR /app

# Dependencias primero (cache de capas)
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json        apps/api/
COPY apps/web/package.json        apps/web/
COPY apps/etl/package.json        apps/etl/
COPY apps/scraper/package.json    apps/scraper/
COPY packages/db/package.json     packages/db/
COPY packages/logger/package.json packages/logger/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/analytics/package.json    packages/analytics/

RUN npm ci --no-audit --no-fund

# Código completo
COPY . .

# Build de producción de la web (las NEXT_PUBLIC_* se hornean aquí)
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SEASON_ID
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
# Token de Sentry: solo se usa en build para subir sourcemaps (no queda en runtime).
ARG SENTRY_AUTH_TOKEN
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SEASON_ID=$NEXT_PUBLIC_SEASON_ID \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build --workspace=apps/web

ENV NODE_ENV=production
