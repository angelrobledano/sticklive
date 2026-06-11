FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Copiar manifiestos primero (cache de capas)
COPY package.json turbo.json ./
COPY apps/scraper/package.json ./apps/scraper/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/logger/package.json ./packages/logger/

RUN npm install

# Copiar código fuente
COPY packages/shared-types ./packages/shared-types
COPY packages/logger ./packages/logger
COPY apps/scraper ./apps/scraper

# Compilar
RUN npm run build --workspace=packages/shared-types && \
    npm run build --workspace=packages/logger && \
    npm run build --workspace=apps/scraper

# Instalar navegadores Playwright (ya incluidos en la imagen base)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

CMD ["node", "apps/scraper/dist/index.js"]
