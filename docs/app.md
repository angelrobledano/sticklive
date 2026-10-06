# App móvil (apps/mobile)

*Expo SDK 57 (React Native 0.86, React 19.2) + expo-router + NativeWind v4. Workspace
`@sports/mobile` del monorepo Turborepo. Este documento describe el código actual
de la rama `feat/app-movil` — cada afirmación está verificada contra el código.
Spec: `docs/superpowers/specs/2026-10-05-app-movil-design.md`; plan:
`docs/superpowers/plans/2026-10-05-app-movil.md`; API consumida: [docs/api.md](api.md).*

## Estado (octubre 2026)

Implementada la paridad funcional v1 (directo, ficha SSE, clasificación, búsqueda,
favoritos, login Google, ajustes, push nativo, analítica y crashes) en Android.
**No hay aún ningún build EAS ni alta en Google Play**: los builds exigen `eas login`
humano y el checklist de Play está pendiente (ver más abajo). Todo lo local
verificable está en verde: typecheck, lint, tests, `expo export` y prebuild.

## Stack y estructura

```text
apps/mobile/
  app/                  Rutas expo-router (cada fichero es una pantalla)
    (tabs)/             index (directo) · standings · search · favorites · settings
    match/[id].tsx      Ficha de partido (SSE + respaldo)
    team/[id].tsx · player/[id].tsx
    settings/notifications.tsx   Preferencias de push
    _layout.tsx         Stack raíz: Sentry init, providers, deep link de push
  src/
    lib/api/            Cliente REST (Bearer), tipos espejo del API
    lib/                session (SecureStore), push, device, analytics, match-stream, time
    hooks/              TanStack Query (queries.ts), favorites, useMatchLive, useDebounced
    context/ · i18n/ · theme/ · components/
  app.config.ts         scheme sticklive, plugins, runtimeVersion, extra.sentryDsn
  eas.json              perfiles development / preview / production
  .env.example          EXPO_PUBLIC_* con comentarios
```

- **Navegación:** expo-router v57, bottom tabs + stack; `typedRoutes` activado.
- **Estilos:** NativeWind v4 (Tailwind) sobre el mismo lenguaje visual que la web.
- **Datos:** TanStack Query con retry que no reintenta 4xx; SSE con
  `react-native-sse` (cabeceras Bearer) y polling de respaldo en la ficha; los
  streams se cierran al perder el foco (`useFocusEffect`). Nada corre en segundo
  plano: el push es el canal fuera de la app.
- **Alias `@/*`:** raíz del proyecto (no `src/`); convención de este repo.

## Variables de entorno (build-time)

Las `EXPO_PUBLIC_*` se incastran en el bundle JS en build (no hay env en runtime).
Referencia: `apps/mobile/.env.example`.

| Variable | Qué hace | Sin valor |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | Base del API. Dev: `http://<IP-LAN>:3000` (el dispositivo no ve `localhost`; emulador Android: `10.0.2.2`). Prod: `https://sticklive.eu/api` | — (obligatoria) |
| `EXPO_PUBLIC_SENTRY_DSN` | DSN de Sentry **de la app** (cliente/plataforma propia en el proyecto Sentry; nunca el DSN del servidor). Viaja además por `extra.sentryDsn` en `app.config.ts` | `Sentry.init` no se llama |
| `EXPO_PUBLIC_POSTHOG_KEY` | Clave pública (write-only) PostHog EU | Analítica no-op: sin cliente, sin red |
| `EXPO_PUBLIC_POSTHOG_HOST` | Host de ingesta (por defecto `https://eu.i.posthog.com`) | Usa el defecto |

Cambiar cualquiera de estas exige **recompilar** (development build o EAS):
no basta recargar JS.

## Sesión (solo Google en v1)

Sesión Bearer opaca idéntica a la web: el token viaja en `Authorization: Bearer`,
se guarda en **SecureStore** (`sticklive.session.token` + email) y caduca a 90 días
con renovación deslizante (server-side). No hay logout en el API: cerrar sesión =
borrar el token local (paridad con la web).

Flujo de login (verificado en `src/context/AuthContext.tsx`, `src/lib/session.ts`,
`apps/api/src/routes/auth.ts`):

1. La app abre el navegador del sistema (`WebBrowser.openAuthSessionAsync`) en
   `GET /auth/google?client=app&device=<deviceId>`, esperando el retorno por el
   scheme `sticklive://auth/callback`.
2. El API firma un **state HMAC** con `{ d: deviceId, n: nonce, client: 'app' }`
   (nonce single-use en BD, consumido en el callback).
3. Google vuelve al callback del API; con `client=app` el callback **NO abre
   sesión**: emite un **código de canje single-use de 120 s**
   (`app_login_codes`, migración 065, guarda SHA-256) y redirige a
   `sticklive://auth/callback?code=…&email=…`. Los fallos también van por el
   scheme (`?error=<reason>`) y la app los muestra en pantalla.
4. La app canjea el código: `POST /auth/exchange { code, deviceId }` →
   `{ session, email }`. Canje atómico single-use (el 2º intento del mismo
   código → 400). El canje **exige el deviceId del login** (migración 068): el
   código queda ligado al device que inició el flujo (`device_hash` en
   `app_login_codes`), de modo que otra app del dispositivo que intercepte el
   scheme no puede canjearlo; un intento fallido no consume el código. La
   sesión **nunca viaja por el custom scheme** (otra app podría interceptarlo).
5. `deviceId` (`src/lib/device.ts`) es el Android ID o un UUID v4 en SecureStore;
   permite adoptar la cuenta anónima del dispositivo al hacer login (misma
   semántica que el `device_id` de la web).

**Setup de Google OAuth (requisito humano):** en Google Cloud Console, el cliente
OAuth de tipo *Web application* del proyecto debe tener autorizado el redirect
`https://sticklive.eu/api/auth/google/callback` (ya lo está para la web) y, para
desarrollo local, `http://localhost:3000/auth/google/callback`. No hace falta
cliente "Android": el consentimiento corre en navegador y el redirect es del API.
El scheme `sticklive` está declarado en `app.config.ts` (`expo.scheme`).

## Push nativo (Expo Push → FCM)

Arquitectura (Tasks 4.1–4.3, verificada en código):

```text
app (expo-notifications) ──POST /push/native/subscribe──▶ push_tokens (065)
                                                              │
ETL cron-live (push-dispatcher.ts) ── segmentación pura ──────┘
  push-segmentation.ts (wants()/morningPendingSubs, compartida con la web)
        │                                    │
        ▼ canal web (VAPID, intacto)         ▼ canal nativo (push-expo.ts)
                                             Expo Push API → FCM → app
```

- **Registro:** la app crea el canal Android `live` **antes** de pedir permiso
  (en Android 13 el prompt no aparece sin canal), obtiene el Expo Push token
  (requiere `extra.eas.projectId` de `eas init`) y sincroniza el estado COMPLETO
  con `POST /push/native/subscribe` (upsert idempotente por token). Con sesión
  viaja Bearer y el token se asocia al usuario; sin ella el `deviceId` es owner.
  Re-suscribir un token que ya tiene fila exige ownership (mismo `deviceId` o
  usuario de la fila): conocer un token ajeno no permite sobrescribirla (403).
  El body valida estrictamente favoritos (UUIDs, tope 200/kind) — un id inválido
  rechaza con 400, nunca se guarda "bien" un dato roto.
- **Contrato de preferencias** (`SubPrefs` de `apps/etl/src/push-segmentation.ts`,
  compartido web/app): `fav_teams/fav_leagues/fav_players`, `presets`
  (`"<tipo>:<id>" → complete|key_events|results|silent`; la LIGA es kind
  `league` pero clave `competition:<id>`) y `config { master?, quietNight? }`
  donde `false` excluye. La app replica este contrato en `src/lib/push.ts`.
- **Emisión:** el dispatcher decide a quién (misma segmentación que la web) y
  `push-expo.ts` envía por lotes de 100 al API v2 de Expo con `channelId: 'live'`,
  `collapseId` = tag del partido (el aviso vivo se reemplaza, no se apila) y TTL
  1 h. Los goles van por evento; el resumen matinal por canal con **ledger propio
  por canal** (`push_summary_log.channel` web|native, migración 066) para que web
  y nativo no se bloqueen ni dupliquen entre sí.
- **Poda de tokens muertos:** por ticket (`DeviceNotRegistered` en la propia
  respuesta del envío) y por recibos (`/push/getReceipts`, lotes de 1000);
  `DELETE` de la fila en `push_tokens`. La desinstalación no deja basura.
- **Deep link:** el payload lleva `data.urlPath` (`/match/<id>` — ruta de la app,
  sin la "s" de la web; corregido en Task 5.4, antes iba la ruta web y el tap
  aterrizaría en pantalla de ruta desconocida) y `data.type`; el tap abre la ruta
  y emite `notification_opened` con `notification_type` (misma propiedad que
  `notification_sent` del servidor: el CTR agrupa ambas plataformas).
- **Pruebas end-to-end:** `POST /push/native/test { expoPushToken, deviceId }`
  (con ownership: conocer un token ajeno no permite enviarle pushes; rate limit
  10/10 min). Expo Go NO vale: no soporta push remoto desde SDK 53 — hace falta
  development build y dispositivo físico; los fallos de registro se reportan con
  motivos explícitos (`src/lib/push.ts`, `PUSH_ERRORS`).
- `POST/DELETE /push/native/subscribe` y `POST /push/native/opened` completan la
  superficie nativa del API (ver [docs/api.md](api.md)).

## i18n compartido con la web

Los diccionarios son **los JSON de la web** (`apps/web/src/locales/{en,es,fr,it,pt}.json`),
importados en relativo por `src/i18n/locales.ts` (el bundler los copia al bundle).
Fuente única de traducciones: una clave nueva se añade en la web y está
disponible en la app. `locales.test.ts` comprueba que **los keysets de los cinco
idiomas coinciden** entre sí (sin claves ausentes ni sobrantes). `resolveKey`
resuelve claves punteadas con fallback a la clave.

## Analítica y crashes

- **PostHog** (`posthog-react-native`, proyecto EU) con **autocapture APAGADO** a
  propósito (ni toques ni pantallas, ni ciclo de vida, ni excepciones — el canal
  de errores es Sentry). Catálogo cerrado en `src/lib/analytics.ts`:
  `match_opened`, `live_tab_viewed`, `favorite_added/removed`, `login_completed`,
  `push_registered`, `push_failed`, `notification_opened`. Identidad: la persona
  anónima es el `deviceId` (el mismo distinctId que los eventos de servidor), se
  fusiona con el email al hacer login y se **resetea al cerrar sesión** para que
  dos cuentas nunca compartan persona. Un único punto de llamada; sin key todo es
  no-op.
- **Sentry** (`@sentry/react-native`): init a nivel de módulo solo con DSN,
  `tracesSampleRate: 0.1`. Publicar **source maps** exige además un
  `sentryCli.authToken` como secret de EAS en build (paso de release, aún pendiente).

## Comandos EAS

Prerequisito único (humano): `npm i -g eas-cli` → `eas login` → en `apps/mobile`:
`npx eas init` (rellena `extra.eas.projectId` en `app.config.ts` **y** sustituye
`<projectId>` en `updates.url`). Sin `projectId` no hay token push ni OTA.

```powershell
cd apps/mobile

# Desarrollo (APK, development client, canal development): Expo Go NO sirve
npx eas build -p android --profile development

# AAB de pruebas internas (canal preview)
npx eas build -p android --profile preview

# Subida a Google Play (pista "internal" en eas.json; exige play-service-account.json)
npx eas submit -p android --latest

# OTA: JS sin revisión de la store (respetando runtimeVersion)
npx eas update --channel preview -m "mensaje"
npx eas update --channel production -m "mensaje"
```

Advertencias verificadas sobre `eas.json` (`appVersionSource: "remote"`,
`autoIncrement: true` en preview/production):

1. **`eas submit --latest` NO filtra por profile:** envía el último build de
   Android sea cual sea. En el orden development → preview → submit funciona por
   orden de ejecución, pero si se reconstruye el APK de development **después**
   del AAB de preview, el submit fallará (Play exige .aab). Ante la duda:
   `eas submit -p android --id <buildId>` del AAB, o reconstruir el AAB justo
   antes del submit.
2. **Versionado:** el `versionCode` lo gestiona **EAS de forma remota**
   (`appVersionSource: remote` + autoIncrement). El bump de la `version` visible
   (`1.0.0` en `app.config.ts`/`package.json`) es **MANUAL en cada release** y,
   además, rota la `runtimeVersion` de OTA (policy `appVersion`): versión nueva =
   runtime nueva, y `eas update` solo toca JS compatible con la runtime instalada.
3. **El profile `preview` usa `distribution: internal` con `buildType:
   app-bundle`:** la URL de internal distribution que devuelve EAS **no sirve
   para instalar AABs** (los navegadores no los instalan); ese AAB va a Play vía
   `eas submit`. Si algún día se quiere distribuir el preview por URL directa,
   hay que cambiar el profile a `distribution: store` o volverlo APK.

## Limitaciones v1

- **Magic links solo web:** el login de la app es solo Google. Añadir magic links
  exige app links de dominio (pendiente).
- **Premium y admin fuera de la app** hasta que el flag se active en web.
- **iOS compilable pero no publicado:** sin cuenta de Apple, sin pruebas en
  dispositivo y sin APNs configurados; su coste real llega al decidir publicar.
- **Expo Go sin push (ni Sentry):** cualquier módulo nativo exige development
  build; Expo Go solo sirve para JS puro.
- **Assets de marca pendientes:** los actuales son los de la plantilla Expo.
  Lista exacta a reemplazar en el plan (Task 5.3, incluido el icono de
  notificación monocromo, que requiere recompilar).
- **Sin E2E bloqueante** en v1 (documentado como limitación en el spec §8).
- La validación de latencia del gol vía FCM frente a la web (objetivo: paridad)
  queda para la prueba interna (checklist de abajo).

## Release a Google Play (pruebas internas) — checklist

Ningún paso ha sido ejecutado aún: los que requieren cuentas son **humano**.
Las verificaciones esperadas de cada paso están anotadas para saber si salió bien.

### Parte A — Cuenta y ficha en Google Play Console (una sola vez)

1. **Cuenta de Google Play Console** (25 USD, pago único). ✔ esperado: cuenta activa.
2. **Crear la app** (nombre "Stick Live", idioma por defecto, app, gratuita).
   ✔ esperado: ficha creada en borrador.
3. **Ficha de Play Store** (título, descripciones corta/completa, icono 512×512,
   gráfico destacado 1024×500, capturas). ⚠️ Los assets de marca aún son los de
   la plantilla: o se sustituyen antes, o se suben provisionales sabiendo que
   son provisionales.
4. **Clasificación de contenido** (cuestionario IARC). ✔ esperado: "Todos" o
   equivalente (no hay violencia real, ni apuestas, ni chat).
5. **Formulario de seguridad de datos** — declarar (basado en el código real):
   - **Email**: se recoge al hacer login con Google (perfil de la cuenta).
   - **Favoritos** (equipos/ligas/jugadores seguidos): guardados en el servidor.
   - **Tokens de push** e identificadores de dispositivo (deviceId, Expo Push token).
   - **Analítica y crashes**: PostHog (EU) y Sentry — eventos de interacción
     (directo, favoritos, push), sin autocapture; el email solo viaja como
     identidad tras login.
   - Todo se envía por HTTPS; ninguna práctica de "recopilación compartida" con
     terceros a efectos del formulario salvo los procesadores (PostHog/Sentry).
6. **Política de privacidad**: URL `https://sticklive.eu/privacy` (ya existe en la
   web; verificar que menciona datos de la app antes de publicar la ficha).
7. **Permisos:** la app solo declara notificaciones (Android 13+, post/install) —
   no pedir permisos de ubicación, cámara ni almacenamiento.

### Parte B — Build y subida (EAS)

8. **Prerequisitos EAS** (ver Comandos EAS): `eas login`, `npx eas init` en
   `apps/mobile` (projectId en `app.config.ts` y en `updates.url`), recompilar.
9. **Cuenta de servicio para submit:** en Play Console → Configuración → Acceso
   API, crear cuenta de servicio con rol de subida y descargar
   `apps/mobile/play-service-account.json` (ignorado por git — verificar que
   `git status` no lo muestra nunca).
10. **Build del AAB:** `npx eas build -p android --profile preview`
    (o `production`). ✔ esperado: build "finished" en expo.dev con artifact `.aab`.
11. **Submit:** `npx eas submit -p android --id <buildId del AAB>` (preferible a
    `--latest`, ver advertencia 1). ✔ esperado: "successfully submitted" y el
    bundle visible en Play Console → Pruebas internas, con el versionCode
    autoincrementado por EAS.
12. **Credenciales de firma:** EAS genera y gestiona el keystore de Play
    (app signing de Google). ✔ esperado: en expo.dev → proyecto → Credentials,
    keystore Android creado sin intervención manual.

### Parte C — Prueba interna y validación en el mundo real

13. **Invitar testers** (lista de correo) en Pruebas internas y compartir el link
    de opt-in. ✔ esperado: el tester instala desde Play tras aceptar.
14. **Validación in-app** (dejar constancia de resultados aquí cuando ocurra):
    - [ ] Login real con Google en dispositivo físico.
    - [ ] Favoritos reales (añadir/quitar, sync con la cuenta).
    - [ ] Push de un gol real en un partido de fin de semana; anotar latencia
          percibida vs la web (objetivo: paridad) y deep link correcto a la ficha.
    - [ ] Consumo de batería/datos razonable tras un partido en directo.
    - [ ] `notification_opened` y demás eventos visibles en PostHog.
15. **OTA de prueba:** `npx eas update --channel preview -m "..."` sobre la build
    instalada. ✔ esperado: la app recarga JS con el cambio sin pasar por Play.
16. **Antes de pasar a producción:** bump manual de `version` (rota runtimeVersion),
    AAB nuevo con versionCode incrementado, y repetir formulario/clasificación si
    cambió el tratamiento de datos.
