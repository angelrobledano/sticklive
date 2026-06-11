# Arquitectura: Plataforma de Resultados Deportivos

## Visión general

```
┌─────────────────────────────────────────────────────────────────┐
│                        FUENTES EXTERNAS                         │
│   hockeypatines.fep.es   ·   otros sitios federaciones         │
└───────────────────┬─────────────────────────────────────────────┘
                    │ Playwright / Cheerio / API oculta
┌───────────────────▼─────────────────────────────────────────────┐
│                    apps/scraper  (Node.js + TS)                 │
│  • BaseScraper → scrapers específicos por fuente                │
│  • Interceptor XHR para cazar APIs JSON                         │
│  • Retries, logging, trazabilidad                               │
│  • Crons por tipo de dato (live: 5min, standings: 1h, etc.)    │
└───────────────────┬─────────────────────────────────────────────┘
                    │ ScrapedXxx (datos crudos con trace)
┌───────────────────▼─────────────────────────────────────────────┐
│                    apps/etl  (Node.js + TS)                     │
│  • Normalización y deduplicación                                │
│  • Resolución de referencias (teamRef → team_id en DB)         │
│  • Upserts idempotentes en PostgreSQL                           │
│  • Registro en scrape_logs                                      │
└───────────────────┬─────────────────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────────────────┐
│                  PostgreSQL (packages/db)                        │
│  sports · competitions · seasons · rounds · matches             │
│  teams · players · standings · match_events · scrape_logs       │
└───────────────────┬─────────────────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────────────────┐
│                    apps/api  (Next.js + TS)                     │
│  • API Routes para frontend                                     │
│  • SSG/ISR para clasificaciones y jornadas                     │
│  • SSR para datos en tiempo real                                │
│  • Caché HTTP (Cache-Control, revalidación)                    │
└─────────────────────────────────────────────────────────────────┘
```

## Decisiones de arquitectura

### 1. Monorepo con Turborepo
**Decisión**: Turborepo + npm workspaces.
**Por qué**: Los tres servicios (scraper, etl, api) comparten tipos y utilidades. Sin monorepo acabarías publicando paquetes npm internos o copiando código. Turborepo gestiona el build incremental sin complejidad.
**Tradeoff**: Curva de aprendizaje inicial, pero vale la pena desde el primer mes.

### 2. Scraper → ETL separados (no scraping directo a DB)
**Decisión**: El scraper produce `ScrapedXxx` (datos crudos), el ETL normaliza y persiste.
**Por qué**: Si la fuente cambia su HTML o API, solo tocas el scraper. La lógica de normalización y deduplicación queda aislada. También facilita re-procesar datos históricos sin volver a scrapear.
**Riesgo mitigado**: Cambio en selectores CSS → solo afecta al scraper, no a la DB.

### 3. Playwright como scraper base (no solo Cheerio)
**Decisión**: Playwright para todas las fuentes inicialmente.
**Por qué**: hockeypatines.fep.es está construido sobre sidgad.com, que es 100% JavaScript. Cheerio solo sirve para HTML estático. Playwright además permite interceptar XHR para cazar APIs JSON ocultas.
**Tradeoff**: Más recursos en producción (~200MB RAM por contexto). Mitigado con un pool de contextos y bloqueo de recursos innecesarios (imágenes, CSS, fonts).

### 4. PostgreSQL (no MongoDB)
**Decisión**: PostgreSQL relacional.
**Por qué**: Los datos deportivos son relacionales por naturaleza (partido → equipo → jugador → evento). Las queries de clasificación y calendario son SQL puro. JSON sería más flexible pero pagarías ese coste en cada query de negocio.
**Tradeoff**: Schema más rígido, pero las migraciones son predecibles.

### 5. Trazabilidad obligatoria en cada registro
**Decisión**: `source_id`, `source_ref`, `source_url`, `scraped_at` en todas las tablas.
**Por qué**: Cuando la fuente cambia su estructura (y cambiará), necesitas saber qué datos son de qué versión del scraper, cuándo se extrajeron y desde dónde. También permite auditoría y debugging sin consultar logs externos.

### 6. Scrapers independientes y ejecutables en aislamiento
**Decisión**: Cada scraper es una clase que hereda `BaseScraper` y se puede ejecutar con `--run-once`.
**Por qué**: Facilita debugging local (`npm run scraper -- --run-once fep_competitions`), testing unitario y despliegue incremental. No necesitas levantar todo el sistema para probar un scraper.

## Estrategia para hockeypatines.fep.es (sidgad.com)

El sitio usa sidgad.com como plataforma deportiva blanca. Esta plataforma suele tener APIs REST internas que el JS del navegador llama. El primer paso es ejecutar `npm run probe` para capturar todas las llamadas de red y ver si hay endpoints JSON.

**Escenario A (óptimo)**: sidgad.com expone una API JSON → scrapers rápidos y fiables, sin parsing HTML.

**Escenario B**: No hay API accesible → scraping HTML con Playwright. Más frágil, requiere selectores específicos por página. Añadir tests de estructura para detectar roturas.

## Frecuencias de scraping sugeridas

| Tipo de dato | Frecuencia | Justificación |
|---|---|---|
| Resultados en vivo | Cada 3-5 min | Solo durante jornadas activas |
| Clasificaciones | Cada hora | Cambian poco |
| Calendarios/Jornadas | Diario (6am) | Cambios ocasionales |
| Equipos/Jugadores | Diario (6am) | Muy estable |
| Competiciones/Temporadas | Diario (6am) | Raramente cambia |

## Próximos pasos

1. Ejecutar `npm run probe` para descubrir APIs de sidgad.com
2. Implementar `FepMatchesScraper` y `FepStandingsScraper`
3. Implementar el ETL con upserts idempotentes
4. Montar el esqueleto de la API Next.js
5. Añadir tests de integridad de scraping (detector de roturas de estructura)
