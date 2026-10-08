# ============================================================
# Imagen única del monorepo Stick Live.
# Se construye una vez y cada servicio (api, web, etl, migrate) arranca con un
# command distinto en docker-compose.prod.yml.
#
# Tres etapas. Antes era una sola, y de ahí salían tres problemas:
#
#   · La imagen de producción llevaba dentro el código fuente TypeScript, todas
#     las devDependencies y el toolchain de build.
#   · Los procesos arrancaban con `npx tsx`, que es devDependency: sin
#     comprobación de tipos al arrancar, transpilando en cada boot, y con
#     `npm audit --omit=dev` auditando algo distinto de lo que corría.
#   · Todo corría como root.
#
# Ahora `builder` compila y empaqueta (scripts/build-server.mjs), y `runtime`
# recibe sólo el resultado más las dependencias de producción.
# ============================================================

# ─── 1. Dependencias completas (capa cacheable) ─────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Sólo los manifiestos: mientras no cambien, npm ci no se repite aunque cambie
# el código.
COPY package.json package-lock.json ./
COPY apps/api/package.json        apps/api/
COPY apps/web/package.json        apps/web/
COPY apps/etl/package.json        apps/etl/
COPY apps/scraper/package.json    apps/scraper/
COPY packages/db/package.json     packages/db/
COPY packages/logger/package.json packages/logger/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/brand/package.json  packages/brand/
COPY packages/analytics/package.json    packages/analytics/

RUN npm ci --no-audit --no-fund


# ─── 2. Build ───────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Comprobación de tipos ANTES de empaquetar. esbuild transpila sin mirar los
# tipos, así que sin esto un error de tipos llegaría a producción convertido en
# un fallo de runtime. El CI ya lo comprueba, pero la imagen no debe depender de
# que alguien haya mirado el CI.
RUN npx tsc --noEmit -p apps/api      \
 && npx tsc --noEmit -p apps/etl      \
 && npx tsc --noEmit -p apps/scraper  \
 && npx tsc --noEmit -p packages/db

# Procesos de servidor → dist/**/*.js ejecutables con node
RUN node scripts/build-server.mjs

# Build de producción de la web (las NEXT_PUBLIC_* se hornean aquí)
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SEASON_ID
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
# Google AdSense (#382): vacío = anuncios apagados. Se hornean en el bundle web.
ARG NEXT_PUBLIC_ADSENSE_CLIENT
ARG NEXT_PUBLIC_ADSENSE_SLOT_HOME_TOP
ARG NEXT_PUBLIC_ADSENSE_SLOT_HOME_INLINE
ARG NEXT_PUBLIC_ADSENSE_SLOT_LIST_INLINE
ARG NEXT_PUBLIC_ADSENSE_SLOT_MATCH_SUMMARY
ARG NEXT_PUBLIC_ADSENSE_SLOT_MATCH_STATS
ARG NEXT_PUBLIC_ADSENSE_SLOT_INTERSTITIAL
ARG NEXT_PUBLIC_ADS_INTERSTITIAL
ARG NEXT_PUBLIC_ADS_LIST_EVERY
# Paywall premium (build): NEXT_PUBLIC_PREMIUM_ENABLED=1 muestra el paywall;
# NEXT_PUBLIC_PAYMENT_PROVIDER elige proveedor ('stripe' | 'redsys').
ARG NEXT_PUBLIC_PREMIUM_ENABLED
ARG NEXT_PUBLIC_PAYMENT_PROVIDER
# Token de Sentry: solo se usa en build para subir sourcemaps (no queda en runtime).
ARG SENTRY_AUTH_TOKEN
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SEASON_ID=$NEXT_PUBLIC_SEASON_ID \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NEXT_PUBLIC_ADSENSE_CLIENT=$NEXT_PUBLIC_ADSENSE_CLIENT \
    NEXT_PUBLIC_ADSENSE_SLOT_HOME_TOP=$NEXT_PUBLIC_ADSENSE_SLOT_HOME_TOP \
    NEXT_PUBLIC_ADSENSE_SLOT_HOME_INLINE=$NEXT_PUBLIC_ADSENSE_SLOT_HOME_INLINE \
    NEXT_PUBLIC_ADSENSE_SLOT_LIST_INLINE=$NEXT_PUBLIC_ADSENSE_SLOT_LIST_INLINE \
    NEXT_PUBLIC_ADSENSE_SLOT_MATCH_SUMMARY=$NEXT_PUBLIC_ADSENSE_SLOT_MATCH_SUMMARY \
    NEXT_PUBLIC_ADSENSE_SLOT_MATCH_STATS=$NEXT_PUBLIC_ADSENSE_SLOT_MATCH_STATS \
    NEXT_PUBLIC_ADSENSE_SLOT_INTERSTITIAL=$NEXT_PUBLIC_ADSENSE_SLOT_INTERSTITIAL \
    NEXT_PUBLIC_ADS_INTERSTITIAL=$NEXT_PUBLIC_ADS_INTERSTITIAL \
    NEXT_PUBLIC_ADS_LIST_EVERY=$NEXT_PUBLIC_ADS_LIST_EVERY \
    NEXT_PUBLIC_PREMIUM_ENABLED=$NEXT_PUBLIC_PREMIUM_ENABLED \
    NEXT_PUBLIC_PAYMENT_PROVIDER=$NEXT_PUBLIC_PAYMENT_PROVIDER \
    NEXT_TELEMETRY_DISABLED=1

# El token de Sentry se pasa SOLO a este comando (#300), nunca como ENV: así no
# queda en el entorno de la imagen ni, por tanto, en runtime.
RUN SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN npm run build --workspace=apps/web

# Dependencias SOLO de producción, para copiarlas a la imagen final. Se hace
# aquí y no en `runtime` para no arrastrar npm ni su caché a la imagen final.
RUN npm ci --omit=dev --no-audit --no-fund


# ─── 3. Runtime ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# util-linux aporta `flock`, del que depende deploy/etl-scheduler.sh para
# serializar el scraping. La variante -slim no lo garantiza, y sin él el
# scheduler aborta (por diseño: correr sin lock permite que dos pipelines
# escriban a la vez sobre las mismas filas).
RUN apt-get update \
 && apt-get install -y --no-install-recommends util-linux \
 && rm -rf /var/lib/apt/lists/*

# Rutas que el código resolvía relativas a su propio fichero. Al correr
# empaquetado desde dist/ ese cálculo apunta a otro sitio, así que se fijan
# aquí. ESCUDOS_DIR además tiene que coincidir con el volumen compartido entre
# web y etl (ver docker-compose.prod.yml).
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    MIGRATIONS_DIR=/app/packages/db/migrations \
    ESCUDOS_DIR=/app/apps/web/public/escudos

# Dependencias de producción (sin tsx, sin typescript, sin toolchain)
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json

# Procesos de servidor ya empaquetados
COPY --from=builder --chown=node:node /app/dist ./dist

# Las migraciones son ficheros .sql que lee el servicio `migrate` en runtime
COPY --from=builder --chown=node:node /app/packages/db/migrations ./packages/db/migrations

# La web: build de Next + lo que necesita para arrancar
COPY --from=builder --chown=node:node /app/apps/web/.next           ./apps/web/.next
COPY --from=builder --chown=node:node /app/apps/web/public          ./apps/web/public
COPY --from=builder --chown=node:node /app/apps/web/package.json    ./apps/web/package.json
COPY --from=builder --chown=node:node /app/apps/web/next.config.mjs ./apps/web/next.config.mjs

# El planificador del ETL
COPY --from=builder --chown=node:node /app/deploy/etl-scheduler.sh ./deploy/etl-scheduler.sh

# El directorio de escudos lo comparten web (lo sirve) y etl (lo escribe). Se
# crea con el dueño correcto para que un volumen NUEVO lo herede; uno ya
# existente conserva su propiedad y hay que corregirlo una vez a mano (ver
# docs/DEPLOY.md).
RUN mkdir -p /app/apps/web/public/escudos \
 && chown -R node:node /app/apps/web/public/escudos

# Nada de esto necesita root. El día que un scraper procese HTML hostil, la
# diferencia entre root y un usuario sin privilegios importa.
USER node
