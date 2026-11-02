# Arquitectura — Stick Live

*Contrastada con el código y la configuración actual (septiembre 2026). Los detalles de ingesta están en [pipeline-datos.md](./pipeline-datos.md), los de datos en [database.md](./database.md) y la operación en [operations.md](./operations.md).*

## Servicios

| Servicio | Tecnología | Puerto | Papel |
|---|---|---|---|
| `apps/scraper` | Node + Playwright/Cheerio | — | Extracción de fuentes (FEP y World Skate, ambas sobre sidgad). La salida HTTP es configurable (directa, Cloudflare Worker o segunda IP de Hetzner): ver [egress-sidgad.md](./egress-sidgad.md). |
| `apps/etl` | Node + TS | — | Carga a BD, crons de directo/calendario/actas, emisor de push, seeds de competiciones |
| `apps/api` | Hono (Node) | 3000 | REST + SSE, auth (magic link + Google OAuth), favoritos, Web Push, admin, Stripe |
| `apps/web` | Next.js 16 (App Router) | 3001 | Frontend mobile-first, PWA, i18n propio ×5 idiomas |
| `postgres` | PostgreSQL 16 | 5432 (solo localhost en prod) | Datos |
| `caddy` | Caddy | 80/443 | HTTPS automático, proxy `/api/*` → api:3000, resto → web:3001 |
| `migrate` | Node (one-shot) | — | Aplica migraciones antes de que arranquen api/etl |

Paquetes compartidos: `packages/db` (cliente pg, migraciones, queries), `packages/shared-types`, `packages/analytics` (posthog-node), `packages/logger` (pino).

```text
sidgad/FEP + wse.sidgad.com
        │ Playwright (APIs JSON internas de sidgad) + Cheerio
        ▼
   apps/scraper ──── apps/etl (crons: directo 5 min, calendario+standings 1 h,
        │            actas diarias; scheduler deploy/etl-scheduler.sh con flock)
        ▼
   PostgreSQL ──(LISTEN/NOTIFY)──▶ apps/api (hub SSE por partido) ──▶ web
        │                          apps/etl (push-dispatcher) ────▶ Web Push
        ▼
   apps/api (REST, Hono) ──▶ apps/web (Next.js) ──▶ usuario
```

## Flujo de datos (de la fuente al usuario)

1. **Alta de competición** — `seed-fep-competition.ts` descubre equipos en la fuente y crea `competitions` + `seasons` (is_current) + `teams` + fila en `competition_sources`. El cron itera esa tabla; dar de alta una liga no requiere tocar código.
2. **Calendario** (`--entity=calendar`, cada hora) — parsea el calendario de la fuente con su **estructura explícita** (fases y cabeceras de ronda) y hace upsert de fases, rondas y partidos (identidad por `source_ref`). Ver modelo de fases en [database.md](./database.md).
3. **Marcadores en directo** (`cron-live`, cada 5 min; bucle activo de 45 s mientras haya partidos en juego) — feed global de marcadores + match center de World Skate. Solo actualiza score/estado de partidos existentes, y el estado solo con señal explícita de la fuente (nunca por la hora).
4. **Actas** (`fichas-pendientes`, diaria; y en cada ciclo de directo para los partidos en juego) — parsea alineaciones, eventos con instante de juego, cuerpo técnico y faltas. `replaceMatchEvents` sincroniza los eventos por `source_ref` derivada del contenido.
5. **Resolución de entidades** — cada referencia de equipo se resuelve a UUID por el embudo: `source_entity_map` (ID de fuente) → `team_aliases` (nombre normalizado) → slug → fuzzy con bloqueo → cola HITL (`resolution_queue`, panel `/admin/resolucion`). Ver [RUNBOOK_ENTITY_RESOLUTION.md](./RUNBOOK_ENTITY_RESOLUTION.md).
6. **Notificación de cambios** — triggers de la migración 043 emiten `pg_notify('match_update')` solo si cambia algo visible; el hub SSE de la API (un poller por partido con fan-out) refresca y emite a los clientes. El push-dispatcher del ETL compara el estado antes/después del ciclo y envía las Web Push que tocan.
7. **La web** renderiza server-side con revalidate por recurso (home 60 s, partido 20 s, standings 300 s), se suscribe al SSE del partido en vista directo y hace polling de respaldo si la conexión cae.

## Entidades (las que existen de verdad)

Núcleo deportivo:

```text
sports ── competitions ── competition_sources (config por fuente: idc, portal)
              │
            seasons (is_current por competición) ── rounds (regular/playoff/cup)
              │                                      │
            teams ── season_teams                 matches ── match_events
              │         │                            │         (particionada por match_date)
            clubs      standings (por season)      match_lineups
              │
   club_names · sponsors · source_entity_map · team_aliases · resolution_queue
   players ── team_players
```

Cuenta y producto: `users` (status admin, sesiones en `user_sessions`), `auth_tokens` (magic links, hasheados), `user_favorites` (equipos/ligas/jugadores), `push_subscriptions` (con `fav_teams`/`fav_leagues`/`fav_players`/`config`), `orders` + `processed_stripe_events` (premium).

Operación: `scrape_logs` (retención 30 días), `import_batches` (trazabilidad de importaciones), `_migrations`.

Detalles de relaciones, constraints e índices: [database.md](./database.md).

## Realtime

- **Emisión:** triggers en `matches`/`match_events` → `pg_notify` (debounce 250 ms en la API) → hub con un poller por partido → fan-out SSE. Poll de respaldo cada 60 s; keepalive 25 s; la conexión se corta a las 2 h con `event: timeout` para que el cliente reconecte. Límite global de conexiones (503 `too_many_connections`).
- **Cliente:** el web reconecta y recibe snapshot completo al reconectar (sin duplicados: los eventos tienen identidad estable por contenido, no posición).
- **Crono y estados:** el instante de juego (25:00 → minuto transcurrido), prórroga y penaltis se derivan del acta; el watchdog `stale-live-watchdog` degrada a `scheduled` los partidos zombi (>5 h en live desde el saque real).
- **Estado del partido, fuente única:** `@sports/shared-types` (`resolveStatusTransition`, `matchDisplayState`). LIVE solo si la fuente lo da en juego (feed FEP, match center World Skate, acta); final por feed, acta (`periodo_fin`) o resultado publicado. API, web y app no derivan `live` de la hora: un partido con la hora pasada y sin señal se muestra «Pendiente».

## Jobs (producción)

| Cadencia | Tarea | Entrada |
|---|---|---|
| 5 min | World Skate (reposo) + `cron-live` (directo) | scheduler, con `flock` |
| Cada hora | calendario + clasificaciones | scheduler |
| Diaria 06 UTC | actas pendientes, purga `scrape_logs`, `partition-guard`, `scrape-health-watch` | scheduler |
| Diaria 04:15 | backup de BD (`/etc/cron.d/sticklive-backup` en el host) | cron del VPS |

Detalles y comportamiento ante fallos: [operations.md](./operations.md).

## Decisiones arquitectónicas relevantes

1. **Monorepo Turborepo + npm workspaces** — scraper/etl/api/web comparten tipos y utilidades sin publicar paquetes.
2. **Scraper y ETL separados** — el scraper produce datos crudos tipados; el ETL normaliza, resuelve y persiste. Un cambio de la fuente solo toca el scraper.
3. **sidgad expone APIs JSON internas** — se capturan con Playwright (interceptando XHR) en lugar de parsear HTML en la mayoría de endpoints; Cheerio queda para HTML. La misma plataforma sirve wse.sidgad.com (segundo portal, mismo cliente parametrizado).
4. **PostgreSQL relacional** — queries de negocio en SQL puro; `match_events` particionada por `match_date` con centinela `match_events_undated` vigilado diariamente.
5. **Idempotencia por `source_ref`** — todos los upserts (partidos, eventos, standings) son re-ejecutables; los eventos tienen identidad derivada del contenido (periodo+crono+tipo+lado), no de su posición, para que las re-notificaciones de push no dupliquen.
6. **Entity Resolution como embudo** — identidad de club separada de secciones y nombres de patrocinio; lo determinista gratis por ID de fuente, lo dudoso a cola humana. Diseño en [ARQUITECTURA_ENTITY_RESOLUTION.md](./ARQUITECTURA_ENTITY_RESOLUTION.md).
7. **Directo: NOTIFY, no polling por cliente** — un poller por partido (no por cliente) con fan-out; la web mantiene polling de respaldo para redes adversas.
8. **Producción corre JS compilado** — `scripts/build-server.mjs` empaqueta con esbuild; la imagen no lleva ni `tsx` ni TypeScript y corre como usuario `node`. El servicio `migrate` aplica migraciones antes de arrancar api/etl.
9. **Auth progresiva** — anónimo por `deviceId` → magic link (Brevo) o Google OAuth al querer sincronizar; favoritos con fusión y tombstones. Tokens hasheados con caducidad.
10. **Salida SIDGAD configurable y fail-safe** — todo el HTTP de scraping pasa por `apps/scraper/src/egress/`. La ruta directa es la primaria; Cloudflare Worker y segunda IP de Hetzner son alternativas deshabilitadas por defecto y solo se usan con autorización explícita de SIDGAD. Un 403/429/5xx nunca provoca cambio de IP; solo DNS/red/timeout pueden hacer failover. Detalle y runbook: [egress-sidgad.md](./egress-sidgad.md).
10. **i18n propio** — diccionarios JSON por idioma bajo `app/[locale]/`, sin dependencia externa; rutas y sitemap multiidioma con hreflang.
11. **La estructura de una competición la publica la fuente** (migración 072) — `Competition → Season → Phase → (Group) → Round → Match`; el "formato" es la secuencia de fases. Orden de evidencia: datos explícitos de la fuente > metadato declarado > regla determinista > fallback avisado. Ninguna capa deduce fases por el nombre de la competición ni por cronología (salvo datos heredados sin re-scrapear, marcados). Diseño en [superpowers/specs/2026-10-08-fases-y-directo-explicito-design.md](./superpowers/specs/2026-10-08-fases-y-directo-explicito-design.md).

## Limitaciones conocidas (decisiones honestas)

- El lanzador de falta directa solo se conoce cuando marca → eficiencia FD solo a nivel de equipo.
- No hay fotos del cuerpo técnico en la fuente → silueta.
- El "al mejor de N" de una serie no viene como dato: se guarda el nº de partido de cada uno (`series_game`, de «2 CUARTOS») y la web distingue serie al mejor de N (la fuente publica el 3.er partido) de ida y vuelta (dos partidos, por goles). No se muestra el N.
- La clasificación no está ligada a una fase (se atribuye a la primera liguilla de la temporada).
- El histórico importado (v1) trae solo marcadores de 8.828 partidos: sin eventos ni fechas para la mayoría (recuperación en curso vía enrich-promote, ver [A5_ENRICH_PROMOTE.md](./A5_ENRICH_PROMOTE.md)).
- Conversión de zonas horarias con `Intl` (base IANA del runtime, cualquier zona). La regla UE sin dependencias (`euZonedToUtc`) sigue disponible para quien pase un offset, con su edge documentado en la ventana 01:00–01:59 local del domingo del cambio de hora.
