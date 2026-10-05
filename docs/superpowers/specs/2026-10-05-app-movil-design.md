# Diseño — App móvil Stick Live (Android primero, iOS preparado)

Fecha: 2026-10-05
Estado: Diseño aprobado en brainstorming; pendiente plan de implementación.

## 1. Contexto y objetivo

Stick Live (web en producción en sticklive.eu) añade su **app móvil**, prevista en el
roadmap de PRODUCT.md ("apps nativas: Android primero, iOS después"). La app se
publica **solo en Google Play** en su primera versión; el proyecto queda **compilable
para iOS** con el mismo código, sin publicarse ni probarse en dispositivo todavía.

Objetivo de producto: llevar el valor central —el marcador en directo, fiable, en el
móvil, con la notificación del gol como momento "aha"— a las tiendas, empezando por
Android, con paridad funcional respecto a la web.

## 2. Decisiones tomadas

| Decisión | Elección |
|---|---|
| Alcance v1 | **Paridad con la web** (directo, ficha de partido, competiciones/clasificación, equipos, jugadores, búsqueda, favoritos, login, ajustes). |
| Premium y admin | **Fuera de la app**: en la web están tras flag y dormidos; la paridad real es no mostrarlos. |
| Push | **En v1**, vía Expo Push (FCM en Android, APNs en el futuro iOS). |
| Login | **Solo Google** en v1 (OAuth en navegador del sistema). Magic links se quedan en web. |
| Lenguaje de diseño | **Marca Stick Live + base nativa**: identidad visual de la web (colores/tipografía) con NativeWind sobre patrones nativos (tabs, bottom sheets, pickers con `@expo/ui`). |
| Stack | **Expo / React Native** en TypeScript. |
| Ubicación | `apps/mobile` en el monorepo Turborepo, con `typecheck`/`lint`/`test` en el pipeline como el resto. |

## 3. Arquitectura

- **App:** `apps/mobile`, Expo (SDK actual), **expo-router** para navegación por
  ficheros, **NativeWind** para estilos con los tokens de diseño de la web.
- **Compartido:** `packages/shared-types` para los DTO de la API. Las traducciones se
  reutilizan desde la web compartiéndolas por el monorepo (paquete compartido o import
  directo; se concreta en el plan). El copy de notificaciones y, si es puro, el
  cálculo de segmentación del emisor, se reutilizan del código existente.
- **API:** la misma API Hono de producción (REST + SSE). La app se configura con
  `EXPO_PUBLIC_API_URL`. Sin cambios en las reglas de seguridad de la API salvo los
  que se listan en §6 y §7.

### Navegación (bottom tabs + stack)

| Tab | Contenido | Equivalente web |
|---|---|---|
| Directo | Partidos de hoy en vivo agrupados por competición | `/` (home) |
| Clasificación | Selector de competición → tabla | `/competitions` |
| Buscar | Equipos, jugadores, competiciones | `/search` |
| Favoritos | Equipos/ligas/jugadores seguidos (requiere sesión) | `/favorites` |
| Ajustes | Notificaciones, idioma, sesión | `/settings` |

Ficha de partido como pantalla a pantalla completa (desde Directo/Buscar/Favoritos),
con detalle de equipo y jugador accesible en stack. Tema claro/oscuro como la web.

## 4. Datos y tiempo real

- **REST + TanStack Query** para todo lo consultable: caché, reintentos, estados de
  carga/error/vacío consistentes; datos en caché visibles mientras refresca (red
  mala de grada).
- **SSE** en la ficha de partido (mismo endpoint que la web) mediante un cliente que
  permita cabeceras de sesión; **poll de respaldo** ante caída, misma filosofía que
  la web. La fiabilidad del directo se mide (conexiones, caídas, reconexiones).
- Solo la ficha en primer plano mantiene SSE abierta; nada escucha en segundo plano.
- Identidad de datos: se respetan los invariantes del repo (identidad por
  `source_ref`, club_id vs team_id resuelto en la API; la app nunca reconcilia).

## 5. Sesión (solo Google)

1. Login con **Google OAuth en navegador del sistema** (flujo estándar de Expo) y
   retorno por **deep link** con scheme propio de la app (`sticklive://`).
2. El `state` firmado del OAuth incluye el cliente (`app`); el callback de la API
   redirige a la app en vez de a la web. Los `client_id` de Google para Android/iOS
   se registran aparte en Google Console (paso manual fuera del repo).
3. El callback **no** entrega la sesión en la URL: entrega un **código de un solo
   uso** (mismo patrón hasheado y atómico que `auth_tokens`); la app lo canjea por su
   sesión, que se guarda en `expo-secure-store` y viaja en cada petición.
4. Mecanismo de transporte de sesión (cabecera Cookie, preferente para no tocar la
   API, o Bearer si `auth-state` exige cambios) se valida en el plan de
   implementación leyendo `auth-state.ts`; el diseño no duplica lógica de auth en el
   cliente.
5. Favoritos requieren sesión, igual que la web.

## 6. Push (Expo Push)

- **App:** registro del token con `expo-notifications` (permiso runtime
  `POST_NOTIFICATIONS` en Android 13+) y envío a la API; baja desde Ajustes.
- **Almacenamiento:** los tokens nativos no caben en `push_subscriptions` (web-push
  con endpoint VAPID). Nueva tabla `push_tokens` (migración idempotente nueva) con
  dispositivo (`expo_push_token`), usuario, preferencias equivalentes
  (equipos/ligas/jugadores favoritos, config, presets, idioma), plataforma y versión
  de app. Upsert idempotente por token.
- **ETL emisor:** la lógica de segmentación/filtrado se extrae para que web-push y
  Expo Push compartan una única fuente de verdad; el emisor envía además vía la API
  HTTP de Expo Push (por lotes, con gestión de recibos y errores explícitos, nunca
  silenciosos). El copy de notificación se reutiliza.
- Consentimiento explícito para suscribir, igual que en la web.

## 7. i18n, analítica y observabilidad

- **i18n:** la app nace multiidioma reutilizando las traducciones de la web.
- **PostHog** (React Native) con **autocapture apagado** (principio del producto):
  interacción con el directo, favoritos, fiabilidad del push. Mismos nombres de
  eventos que la web donde aplique.
- **Sentry** (React Native) para crashes, paralelo a la web.
- Fallos de envío/push en el ETL: log explícito.

## 8. Testing

Priorizado según AGENTS.md:

- **P0/P1:** cliente de sesión (almacenamiento seguro, transporte, caducidad),
  canje de código OAuth (un token de Google falsificado no activa sesión),
  reconexión SSE/poll de respaldo, registro y baja de push, y el doble canal del
  emisor (web-push + Expo Push) con su segmentación.
- **P2:** hooks de datos, mapeo DTO → modelos de app.
- Unit tests con **vitest** (runner del repo). La app se prueba contra la API real
  en desarrollo para integración. Pruebas de componentes según necesidad; sin E2E
  bloqueante en v1 (queda documentado como limitación).

## 9. Release

- **EAS Build** con perfiles `development` / `preview` / `production`.
- Google Play: **AAB**, empezando por **pruebas internas/cerradas** antes de
  producción. Versionado por `app.config` + EAS.
- **expo-updates** por canales: correcciones de JS sin esperar revisión de la store.
- El desarrollo diario necesita un **development build** (EAS o Android Studio
  local): Expo Go ya no soporta push remoto en Android.
- **iOS:** proyecto compilable con EAS; sin registro de Apple, sin pruebas en
  dispositivo y sin publicación en v1.
- **CI:** `apps/mobile` entra en el pipeline Turborepo (typecheck, lint, tests,
  `npm audit --omit=dev`) como el resto; builds de EAS disparados manualmente.
- Prerrequisitos externos (dependen del usuario): cuenta de Google Play Console,
  ficha de la app, formulario de seguridad de datos, URL de política de privacidad
  (ya existe en la web), y registro del scheme/clients OAuth en Google Console.

## 10. Hitos previstos para el plan

1. **M1 — Esqueleto:** scaffold de `apps/mobile` (Expo + router + NativeWind + tema
   de la web), navegación por tabs, CI conectado, pantallas base navegables.
2. **M2 — Directo:** datos reales (REST + Query): home de directo, ficha de partido
   con SSE y respaldo, clasificación, búsqueda.
3. **M3 — Cuenta:** Google OAuth con deep link, favoritos, ajustes de sesión.
4. **M4 — Push:** tabla de tokens nativos, emisor dual en ETL, registro y permisos
   en la app, preferencias de notificación.
5. **M5 — Cierre:** i18n compartido, Sentry/PostHog, tema oscuro, estados vacío/
   error/red en todas las pantallas, EAS + prueba interna en Google Play.

## 11. Limitaciones conocidas y riesgos

- Magic links solo web en v1; se añadirán a la app más adelante (requieren app links
  de dominio).
- Premium/admin fuera de la app hasta que el flag se active en web.
- iOS sin validar en dispositivo en v1; su coste real de puesta a punto (cuentas,
  certificados, notificaciones APNs) llega cuando se decida publicar.
- SSE en RN depende de cliente con soporte de cabeceras; si fallara, el poll de
  respaldo ya cubre el servicio (con latencia mayor).
- Latencia del gol en Android vía FCM/Expo Push debe validarse en prueba interna
  frente a la web (objetivo: paridad).
- Revisión de Google Play (seguridad de datos, permiso de notificaciones) puede
  requerir ajustes de ficha; se resuelve en la fase de release.
