# Stick Live — Estado del proyecto

*Actualizado: 11 de junio de 2026*

---

## Resumen ejecutivo

**Stick Live** es una plataforma de resultados de hockey sobre patines en tiempo real, construida con arquitectura de producción (no un prototipo). Obtiene los datos de las fuentes oficiales mediante scraping y ETL propios, y los sirve en una web mobile-first al estilo FotMob/Sofascore.

**Qué funciona hoy, de punta a punta:**

- **Datos en directo** de la OK Liga masculina (temporada 2025/26, liga regular + playoffs fusionados como fases de una misma competición), con marcadores que se actualizan en la web vía SSE sin recargar.
- **Profundidad de datos**: actas completas (goles, asistencias, tarjetas, faltas de equipo, faltas directas y penaltis con su resultado), alineaciones con dorsales y capitanes, fotos de jugadores, cuerpo técnico, clasificaciones con zonas de playoff/descenso, bracket de playoffs y playoff 9º–10º por plaza europea (WSE Cup).
- **Producto**: favoritos (equipos y ligas) con autenticación progresiva —anónimo → magic link → favoritos en la nube—, premium de pago vía Redsys (sandbox), preferencias de notificaciones, modo oscuro premium, y panel de administración de usuarios.
- **Internacionalización completa** en 5 idiomas (es, en, pt, fr, it) con URLs por idioma (`/es/...`) y hreflang: lista para SEO internacional desde el primer despliegue.
- **Analítica de producto** (PostHog, región EU) con plan de tracking orientado a funnels: activación (favoritos), conversión a cuenta, consumo en directo y checkout premium.

**Qué falta para el lanzamiento:** automatizar los procesos de datos en el servidor (cron), desplegar a VPS, activar notificaciones push reales (VAPID + Service Worker) y envío de emails (SMTP) para los magic links.

---

## Resumen técnico

### Arquitectura

Monorepo Turborepo (npm workspaces) con separación estricta de responsabilidades:

```
apps/
  scraper/   Playwright + Cheerio — extracción de las fuentes oficiales
  etl/       Pipeline de carga + crons (live, calendario, fichas)
  api/       Hono (Node) — REST + SSE, puerto 3000
  web/       Next.js 14 App Router — puerto 3001
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
- **Pipeline por entidades**: `calendar | standings | matches | ficha | fichas-pendientes | refichas | download-logos`, multi-competición (`IDC` como lista).

### API (Hono)

REST: competiciones (+temporadas históricas), overview de temporada (clasificación, jornadas, fases de playoff), estadísticas de temporada (goleadores, asistentes, tarjetas, eficiencia a bola parada por equipo), detalle de partido/equipo/jugador, partidos en vivo. SSE por partido para el directo. Autenticación por magic link con sesiones por token opaco y fusión de favoritos anónimos al iniciar sesión. Pagos Redsys (creación firmada + webhook). Admin protegido por `ADMIN_TOKEN` (comparación en tiempo constante; 503 si no está configurado).

### Web (Next.js 14)

- **Vistas**: home de partidos por día con sección "Siguiendo", competición (clasificación con zonas, jornadas, playoffs con bracket informativo, estadísticas con top-5 expandibles), ficha de partido (timeline espejo, alineaciones, estadísticas con eficiencias), ficha de equipo (resumen, calendario, plantilla con fotos y cuerpo técnico, estadísticas), ficha de jugador, favoritos, login, ajustes, admin.
- **Tiempo real**: SSE con reconexión + polling de respaldo (30s) + refresco de partidos atrasados.
- **i18n propio** (sin dependencias): diccionarios JSON por idioma, interpolación, fallback es→clave, fechas/meses vía `Intl` con el locale activo.
- **Routing por idioma**: todas las rutas bajo `app/[locale]/`; middleware que redirige según cookie → `Accept-Language` → `en`; `generateMetadata` con canonical + hreflang (incl. `x-default`) en las páginas indexables; `<html lang>` correcto desde servidor.
- **Diseño**: mobile-first, dark mode con superficies elevadas (no negro plano), toggles iOS-style, contrastes AA, targets táctiles 44px, branding "Stick Live" sin referencias a la fuente de datos.
- **Analítica**: PostHog con autocapture apagado, pageviews manuales con rutas normalizadas (`/matches/:id`), 9 eventos de plan de tracking, `identified_only`, captura desactivada en desarrollo.

### Base de datos (16 migraciones)

Esquema: competitions/seasons/rounds/teams/season_teams/matches/events/standings/players/team_players/match_lineups + users/orders (premium), auth_tokens/user_favorites (auth progresiva), users.status (admin). Migrador idempotente con tabla `_migrations` y bootstrap de esquemas preexistentes.

### Operativa actual

- Entorno: `docker compose up -d` (Postgres) + `npm run dev` (turbo: scraper/etl/api/web).
- Migraciones: `npm run db:migrate`.
- Variables clave: `SEASON_ID`, `IDC=3150,3481`, `ADMIN_TOKEN`, `POSTHOG_*`, `NEXT_PUBLIC_*`.

### Pendiente (prioridad)

1. **Tareas programadas** (Task Scheduler / cron): cron-live cada 5 min, calendario cada hora, fichas pendientes diario. Prueba de fuego: final HCL–IHC.
2. **Deploy a VPS**: Docker + crons + `NEXT_PUBLIC_SITE_URL` para hreflang/canonical.
3. **Push real**: claves VAPID + Service Worker; SMTP para magic links (hoy modo dev: el enlace se muestra en pantalla). Evento `premium_purchased` desde el webhook Redsys.
4. **Google OAuth** (hoy stub honesto) y roles de admin de nivel 2 (sin token compartido).
5. **Producto B2B de scouting** (idea estratégica): el histórico de actas habilita series temporales por jugador (evolución goleadora, disciplina, minutos en pista) que la web pública no enseña. Cuando el dato histórico esté cargado, diseñar un endpoint de export / API de datos como producto de pago para equipos, separado de la app de resultados.

### Limitaciones de datos conocidas (decisiones honestas)

- El lanzador de falta directa solo se conoce cuando marca → eficiencia FD a nivel de equipo.
- No existen fotos del cuerpo técnico en la fuente → silueta.
- El formato de las series de playoff ("al mejor de N") no es inferible de la fuente → no se muestra; requeriría campo `best_of` curado.
