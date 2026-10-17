# API (apps/api)

*Hono sobre Node, puerto 3000 (env `PORT`). En producción se sirve en `https://sticklive.eu/api` (Caddy elimina el prefijo `/api`). Endpoints verificados en el código actual — no existe OpenAPI/Swagger; este documento es la referencia.*

## Convenciones

- Errores JSON `{ "error": "..." }`; handler global que **no** filtra `err.message` al cliente (lo loguea en servidor y Sentry).
- `Cache-Control` por recurso en lecturas (`read-cache.ts`) + rate limit en memoria por ruta+IP (`rate-limit.ts`).
- Body limit global 64 KB. CORS con allowlist (`WEB_BASE_URL` + localhost dev).
- Health: `GET /health/live` → `{ status: "ok" }` (liveness, sin BD; lo usa el healthcheck del contenedor) y `GET /health` → `{ status: "ok", db: "ok" }` (readiness, `SELECT 1`; 503 si Postgres no responde; lo usa el monitor externo).

## Lecturas públicas

| Método | Ruta | Propósito |
|---|---|---|
| GET | `/competitions` | Listado de competiciones con su temporada actual (nombre i18n, género, categoría, organizador, counts) |
| GET | `/competitions/:id/seasons` | Temporadas históricas de una competición (selector de la ficha) |
| GET | `/seasons/:id/overview` | Clasificación + jornadas/fechas + partidos de una temporada (la página de competición) |
| GET | `/seasons/:id/standings` | Solo clasificación (soporta grupos) |
| GET | `/seasons/:id/matches` | Partidos de la temporada (filtros por jornada/estado/equipo) |
| GET | `/seasons/:id/stats` | Líderes de temporada (goleadores, asistentes, tarjetas, eficiencias) |
| GET | `/matches/live` | Partidos en juego ahora (API pública; **sin consumidor interno**, ver nota) |
| GET | `/matches/current` | Ventana de la home (por defecto ±días; `?from=&to=` / `?days=`) |
| GET | `/matches/:id` | Detalle de partido: eventos, estadísticas, alineaciones |
| GET | `/matches/:id/stream` | **SSE** del directo (snapshot inicial + eventos; timeout a 2 h con `event: timeout`) |
| GET | `/teams/:id` | Ficha de equipo: club canónico, standing, partidos, plantilla, cuerpo técnico, estadísticas |
| GET | `/teams/:id/logo` | Escudo (volumen local o proxy del CDN de la fuente) |
| GET | `/players/:id` | Ficha de jugador |
| GET | `/players/:id/photo` | Foto (proxy del CDN) |
| GET | `/meta/sitemap` | IDs para el sitemap dinámico de la web: competiciones visibles con partidos, equipos con partidos en temporadas visibles, jugadores de competiciones `top_tier` y partidos de los últimos 60 días y los próximos 14 |
| GET | `/redirects/:type/:id` | Ficha que ya no existe (`type` = competition, team, player o match): `{ status: 'moved', newId }`, `{ status: 'gone' }`, `{ status: 'hidden', since }` si existe pero está oculta por calidad (partidos y competiciones, F1-6) o 404 si el id no consta. 400 si el tipo o el id no son válidos |

Rate limit de lectura: **120/min por IP** en `GET /competitions`, `/search`,
`/seasons/:id/overview`, `/seasons/:id/stats`, `/seasons/:id/matches`,
`/seasons/:id/standings`, `/matches/:id`, `/matches/live`, `/matches/current`,
`/teams/:id`, `/players/:id` y `/meta/sitemap`.

### `/seasons/:id/overview` — estructura de la temporada (072)

Además de lo de siempre, expone la estructura **explícita** que guardó el ETL desde la fuente
(`apps/api/src/lib/season-structure.ts`; `/teams/:id` usa la misma función):

- `season.phases[]`: `{ id, ordinal, kind: 'league'|'groups'|'knockout', isPlacement, name,
  hasStandings, stages: ['quarters','semis','final'…], stagesInferred, fromSource }`. `fromSource=false`
  = fase heredada del backfill, aún sin re-scrapear (los clientes mantienen la presentación de antes).
- `rounds[]`: `phaseId`, `stage`. No se exponen las rondas heredadas vacías.
- `matches[]`: `phaseId`, `stage`, `seriesGame` (nº de partido de la serie) y `stageInferred`.
- Campos **legados** (se mantienen para clientes antiguos), ahora calculados desde la fase explícita:
  `roundNumber` (jornada; en eliminatorias 1 = cuartos, 2 = semis, 3 = final, 0 = colocación),
  `roundType` y `season.competitionFormat` (`league` | `bracket` | `final_four`, derivado de las fases;
  en temporadas solo heredadas, el declarado). Ya no se deduce nada del nombre de la competición ni por
  cronología, salvo el playoff heredado en una única ronda (deducción de siempre, marcada `stageInferred`).

### `/matches/live` — estado real (#190)

Endpoint público razonable (PWA / cliente de API), pero **hoy no lo llama nadie
dentro del proyecto**:

- La web usa `GET /matches/current` (hook `useLiveScores`) para la home. Desde
  el 08/10/2026 ningún endpoint ni cliente pinta `live` por la hora: el estado
  es el de la BD, que solo cambia con una señal explícita de la fuente.
- La ficha de partido usa `GET /matches/:id` + `GET /matches/:id/stream` (SSE).
- `getLiveMatches()` en `apps/web/src/lib/api/client.ts` está definido pero sin
  llamadas.

Decisión: **se mantiene como API pública** (no se depreca). Diferencia con
`/matches/current`: `/matches/live` es estrictamente "en juego ahora" por estado
de BD; `/matches/current` devuelve la ventana configurable de la home (pasados y
próximos). Un futuro consumidor interno debería preferir `/matches/current` o el
SSE, no este endpoint.

## Cuenta y favoritos (`/auth`)

| Método | Ruta | Propósito / notas |
|---|---|---|
| POST | `/auth/magic-link` | Envía magic link por email (Brevo). Rate limit 5/h. Sin SMTP configurado devuelve 503 (nunca filtra el enlace salvo modo dev explícito `AUTH_DEV_LINKS=1` fuera de producción) |
| POST | `/auth/verify` | Canjea el token del magic link (single-use atómico) y devuelve sesión. Rate limit 20/10 min. Fusiona los favoritos del dispositivo anónimo |
| GET | `/auth/me` | Usuario de la sesión actual (Bearer token) |
| GET | `/auth/google` + `/auth/google/callback` | OAuth Google (state firmado HMAC, validado en callback). La app móvil entra con `?client=app&device=<id>` y el callback le entrega un código de canje por el scheme `sticklive://` en vez de abrir sesión web |
| POST | `/auth/exchange` | Canjea el código single-use del login de la app móvil (120 s) por sesión Bearer. El código va ligado al deviceId que inició el login (`device_hash`, migración 068): `{ code, deviceId }` solo canjea con el deviceId del origen; un intento fallido no consume el código. Rate limit 10/10 min |
| POST | `/auth/favorites/merge` | Fusión de favoritos anónimos → cuenta (cap 200/kind) |
| DELETE | `/auth/favorites` | Elimina un favorito de la nube (`{ kind, refId }`) |

Sesión: Bearer token opaco, hasheado en BD (`user_sessions`), caducidad 90 días con renovación deslizante.

## Push (`/push` — web y nativo)

| Método | Ruta | Propósito |
|---|---|---|
| POST | `/push/subscribe` | Registra/actualiza suscripción (con `fav_teams`/`fav_leagues`/`fav_players` y `config` de presets) |
| DELETE | `/push/subscribe` | Da de baja por endpoint |
| POST | `/push/opened` | Beacon de apertura de notificación (rate limit 120/min) |
| POST | `/push/test` | Envío de prueba por deviceId (rate limit 10/10 min) |

### Push nativo de la app (`/push/native/*`, Expo Push → FCM)

| Método | Ruta | Propósito |
|---|---|---|
| POST | `/push/native/subscribe` | Registra/actualiza el dispositivo nativo (upsert idempotente por `expo_push_token`; misma segmentación que la web). Auth opcional: con Bearer el token queda asociado al usuario. Ownership si el token ya existe: solo re-suscribe el dueño (mismo `deviceId` o usuario de la fila); si no, 403 sin tocar la fila |
| DELETE | `/push/native/subscribe` | Da de baja el token con ownership (deviceId o usuario de la sesión); idempotente |
| POST | `/push/native/test` | Envío de prueba Expo Push con ownership por token (rate limit 10/10 min) |

Emisor real (goles, inicio/final, resumen matinal) en el ETL: `push-dispatcher.ts`
con canal nativo `push-expo.ts`. Detalle: [docs/app.md](app.md).

## Pagos (Stripe — proveedor activo)

| Método | Ruta | Propósito |
|---|---|---|
| POST | `/payments/stripe/checkout` | Crea sesión de checkout (rate limit 10/min; bloquea si premium activo) |
| POST | `/payments/stripe/webhook` | Webhook firmado, idempotente por `event.id` (`processed_stripe_events`) |
| GET | `/payments/stripe/status` | Estado premium del usuario (fuente de verdad: `premium_until > NOW()`) |
| GET | `/payments/stripe/session/:id` | Verifica una sesión de checkout con Stripe y devuelve el entitlement (`paid`, `premium`, `premiumUntil`). Lo usa `/premium/success` para no conceder premium sin pago confirmado (#252) |

## Admin (header `X-Admin-Token`; 503 si `ADMIN_TOKEN` no está configurado)

| Método | Ruta | Propósito |
|---|---|---|
| GET | `/admin/users` | Listado de usuarios (email, device, premium, estado) |
| PATCH | `/admin/users/:id/status` | Habilitar/deshabilitar (cierra sus sesiones) |
| DELETE | `/admin/users/:id` | Eliminar usuario |
| GET | `/admin/resolution-queue` (+ `/stats`) | Cola de resolución de entidades y métricas de salud |
| POST | `/admin/resolution-queue/:id/resolve` · `/:id/reject` | Resolver/descartar de la cola (aprende alias) |
| GET | `/admin/competitions/archived` · `/duplicates` | Competiciones archivadas / candidatas a duplicado |
| POST | `/admin/competitions/:id/archive` · `/:id/restore` · `/competitions/merge` | Archivar, restaurar y fusionar competiciones |

El panel web de administración vive en `/admin/resolucion` (web).
