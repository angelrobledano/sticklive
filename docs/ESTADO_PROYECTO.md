# Stick Live — Estado del proyecto

*Actualizado: 27 de julio de 2026 — EN PRODUCCIÓN: https://sticklive.eu*

> **Julio 2026:** sprint de endurecimiento de plataforma (bloques 1 y 2 de la [auditoría de arquitectura](./AUDITORIA_ARQUITECTURA_2026-07-19.md) cerrados). Producción corre JS compilado (sin `tsx`), imagen Docker multi-stage como usuario `node` con servicio `migrate` automático, Next 16, audit de dependencias bloqueante en CI y tests de integración contra Postgres real. Detalle en el [CHANGELOG](./CHANGELOG.md). Runtime y comandos de runbook: ver nota de "Runtime de producción" abajo.

> Historial detallado en [CHANGELOG.md](./CHANGELOG.md) · Alta de competiciones en [RUNBOOK_COMPETICIONES.md](./RUNBOOK_COMPETICIONES.md) · Avisos en [NOTIFICACIONES.md](./NOTIFICACIONES.md).

---

## Resumen ejecutivo

**Stick Live** es una plataforma de resultados de hockey sobre patines en tiempo real, **desplegada y pública en https://sticklive.eu**. Obtiene los datos de las fuentes oficiales mediante scraping y ETL propios, y los sirve en una web mobile-first al estilo FotMob/Sofascore, instalable como app (PWA).

**Qué funciona hoy, de punta a punta:**

- **En producción**: VPS Hetzner (CX23, Nuremberg) con Docker Compose — Postgres, API, web y scheduler de scraping (directo cada 5 min, calendario cada hora, actas a diario). HTTPS automático con Caddy, dominio `sticklive.eu` (+ www).
- **Datos en directo multi-competición**: el directo arranca con la OK Liga (masculina, liga + playoffs como fases) y se ha ampliado a **todas las competiciones senior y copas de la temporada en curso** mediante una pasada adicional aislada en el cron de directo (no toca el camino crítico de la OK Liga). SSE en la web y **notificaciones push reales** (Web Push/VAPID) con disparadores de inicio, gol, final, **inicio/fin de jornada**, **competición seguida** y **gol de jugador seguido**, segmentadas por favoritos y preferencias por entidad, con smart bundling y silencio nocturno (ver [NOTIFICACIONES.md](./NOTIFICACIONES.md)).
- **OK Liga Femenina** unificada como una sola competición (liga + playoff dentro), igual que la masculina; las copas/campeonatos de España se modelan como rondas de playoff.
- **Histórico multianual**: catálogo completo RFEP 1999/00→2025/26 importado (≈390 temporadas, 9.600 partidos, clasificaciones y escudos); actas detalladas en proceso de scraping (~9.500). Modelo preparado para federaciones autonómicas (taxonomía organizer/scope/región/categoría de edad; piloto FMP listo para ejecutar). *Nota operativa: la BD de producción se reconstruyó el 16/06 partiendo solo de la OK Liga vigente; el histórico se vuelca aparte (ver runbook).*
- **Producto**: favoritos de **equipos, ligas y jugadores** con **sincronización en la nube write-through** (cada cambio viaja al instante entre dispositivos, con tombstones para que una baja sin conexión no reaparezca) y autenticación progresiva (anónimo → magic link por email real vía Brevo, o **Google OAuth** → multi-dispositivo). Compartir nativo (partido/equipo/liga/jugador + alineación como imagen, con pre-generación para iOS), **instalación como app desde el navegador** (PWA con botón de instalar + instrucciones iOS), pista de hockey con el 5 inicial, timeline con crono real en cuenta atrás, **toolbar de filtros en competición** (jornada / fecha / equipo con estado en la URL), y panel de administración.
- **Gratis de momento**: monetización (premium + anuncios) oculta tras flag. Stripe implementado y dormido (Redsys como alternativo).
- **i18n** en 5 idiomas con URLs por idioma y hreflang; **SEO**: sitemap multiidioma dinámico, robots, metadata por ficha, schema.org (SportsEvent/SportsTeam/Person) e **imágenes Open Graph dinámicas por partido** (escudos + marcador vía `next/og`) más una OG estática de marca. Dado de alta en Search Console.
- **Analítica** (PostHog EU): pageviews normalizadas y eventos de funnel (favoritos, login, compartir, checkout, push).

**Qué falta:** volcado del histórico local → servidor (en curso), reproceso de actas con crono exacto (refichas), importar federaciones autonómicas, APK/iOS con Capacitor, y monetización cuando toque. **Pendiente inmediato:** prueba end-to-end de las notificaciones en directo durante un partido real de playoff (19/21/23 junio).

---

## Resumen técnico

### Arquitectura

Monorepo Turborepo (npm workspaces) con separación estricta de responsabilidades:

```
apps/
  scraper/   Playwright + Cheerio — extracción de las fuentes oficiales
  etl/       Pipeline de carga + crons (live, calendario, fichas)
  api/       Hono (Node) — REST + SSE, puerto 3000
  web/       Next.js 16 App Router — puerto 3001
packages/
  db/        Cliente pg + 16 migraciones SQL versionadas
  analytics/ posthog-node (eventos de servidor)
  logger/    Logging compartido
```

Postgres en Docker. Todo TypeScript estricto.

### Capa de datos (scraping + ETL)

- **Fuentes**: endpoints descubiertos mediante probes de Playwright (calendario, marcadores en vivo, ficha de partido, fotos de jugador).
- **Ficha de partido**: parser que extrae eventos con instante de juego (el reloj descuenta de 25:00 → conversión a minuto transcurrido), alineaciones (dorsal, portero, 5 inicial, capitán, goles, asistencias), cuerpo técnico por rol (E1/E2/A/D) y faltas de equipo. El resultado de faltas directas y penaltis (marcado/fallado) se infiere cruzando el instante del lanzamiento con los goles.
- **Modelo de fases**: liga y playoff comparten temporada; los partidos de playoff se marcan con rounds `round_type='playoff'` y la API deriva cuartos/semis/final por ordenación de series. Las series de colocación (9º–10º) se detectan automáticamente.
- **Resiliencia**: reconciliación de partidos sintéticos duplicados, recuperación de partidos atascados (overdue 48h), deduplicación de clasificaciones, modo `refichas` para reprocesar actas.
- **Pipeline por entidades**: `calendar | standings | matches | ficha | fichas-pendientes | refichas | download-logos`. Con `COMPETITION_SOURCES_DRIVEN=1`, calendar/standings/fichas-pendientes iteran todas las competiciones activas de `competition_sources` (alta de liga = un INSERT); sin el flag, modo single vía `--season-id`/`--idc`.

### API (Hono)

REST: competiciones (+temporadas históricas), overview de temporada (clasificación, jornadas, fases de playoff), estadísticas de temporada (goleadores, asistentes, tarjetas, eficiencia a bola parada por equipo), detalle de partido/equipo/jugador, partidos en vivo. SSE por partido para el directo. Autenticación por magic link con sesiones por token opaco y fusión de favoritos anónimos al iniciar sesión. Pagos Redsys (creación firmada + webhook). Admin protegido por `ADMIN_TOKEN` (comparación en tiempo constante; 503 si no está configurado).

### Web (Next.js 16)

- **Vistas**: home de partidos por día con sección "Siguiendo", competición (clasificación con zonas, jornadas, playoffs con bracket informativo, estadísticas con top-5 expandibles), ficha de partido (timeline espejo, alineaciones, estadísticas con eficiencias), ficha de equipo (resumen, calendario, plantilla con fotos y cuerpo técnico, estadísticas), ficha de jugador, favoritos, login, ajustes, admin.
- **Tiempo real**: SSE con reconexión + polling de respaldo (30s) + refresco de partidos atrasados.
- **i18n propio** (sin dependencias): diccionarios JSON por idioma, interpolación, fallback es→clave, fechas/meses vía `Intl` con el locale activo.
- **Routing por idioma**: todas las rutas bajo `app/[locale]/`; middleware que redirige según cookie → `Accept-Language` → `en`; `generateMetadata` con canonical + hreflang (incl. `x-default`) en las páginas indexables; `<html lang>` correcto desde servidor.
- **Diseño**: mobile-first, dark mode con superficies elevadas (no negro plano), toggles iOS-style, contrastes AA, targets táctiles 44px, branding "Stick Live" sin referencias a la fuente de datos.
- **Analítica**: PostHog con autocapture apagado, pageviews manuales con rutas normalizadas (`/matches/:id`), 9 eventos de plan de tracking, `identified_only`, captura desactivada en desarrollo.

### Base de datos (26 migraciones)

Esquema: competitions/seasons/rounds/teams/season_teams/matches/events/standings/players/team_players/match_lineups + users/orders (premium), auth_tokens/user_favorites (auth progresiva), users.status (admin), push_subscriptions (+ `fav_leagues`/`fav_players` para segmentar avisos). Migrador idempotente con tabla `_migrations` y bootstrap de esquemas preexistentes. Migraciones recientes: **025** (favoritos de liga/jugador en suscripciones push), **026** (fusión del playoff femenino dentro de la liga femenina). El runner lo ejecuta el servicio `migrate` del compose en cada `up` (antes de api/etl); para lanzarlo suelto, `$DC run --rm migrate`. Tras reconstruir la BD hay que reaplicarlas todas.

**Deduplicación de equipos al añadir competiciones nuevas:** decisión de modelo — los equipos se resuelven **por referencia FEP** (`source_ref`/`alt_source_refs`), no por slug, de modo que un mismo club que juega OK Liga y Campeonato de España es una sola entidad. Si no hay match, se crea con slug único (sufijo de género/ref). Detalle operativo en el [runbook](./RUNBOOK_COMPETICIONES.md).

### Operativa actual

- Entorno: `docker compose up -d` (Postgres) + `npm run dev` (turbo: scraper/etl/api/web).
- Migraciones: `npm run db:migrate`.
- Variables clave: `COMPETITION_SOURCES_DRIVEN=1` (el cron itera `competition_sources`; alta de liga = un INSERT), `ADMIN_TOKEN`, `POSTHOG_*`, `NEXT_PUBLIC_*`. `SEASON_ID`/`IDC` quedan **deprecados** (sólo usos manuales de `run-pipeline` en modo single).

### Pendiente (prioridad)

1. **Volcado del histórico** al servidor (pg_dump local → restore) en cuanto termine el scraping de actas, y después `refichas` para capturar el crono MM:SS exacto en el timeline.
2. **Federaciones autonómicas**: ejecutar el piloto FMP (catálogo + siembra + scraping con `SIDGAD_PORTAL=fmp`); después andaluza/valenciana/catalana por config.
3. **APK Android (Capacitor)** sobre la PWA ya instalable; iOS más adelante (cuenta Apple 99 €/año, mitigar guideline 4.2 con push nativas).
4. **Monetización** cuando haya tracción: activar flag `NEXT_PUBLIC_PREMIUM_ENABLED=1` + claves Stripe (todo implementado, incl. webhook con `premium_purchased`).
5. **Admin nivel 2**: roles de usuario en vez de token compartido.
6. **Producto B2B de scouting** (idea estratégica): el histórico de actas habilita series temporales por jugador (evolución goleadora, disciplina) que la web pública no enseña. Con el dato cargado, diseñar un endpoint de export / API de datos como producto de pago para equipos, separado de la app de resultados.

### Limitaciones de datos conocidas (decisiones honestas)

- El lanzador de falta directa solo se conoce cuando marca → eficiencia FD a nivel de equipo.
- No existen fotos del cuerpo técnico en la fuente → silueta.
- El formato de las series de playoff ("al mejor de N") no es inferible de la fuente → no se muestra; requeriría campo `best_of` curado.
