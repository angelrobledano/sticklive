# Monetización — publicidad web (Google AdSense) y premium

*Estado: **ACTIVADO en producción el 2026-10-08** (client-only: el tag de AdSense
ya se sirve con `ca-pub-2994866776026136`; sin bloques aún — las superficies se
encienden en un segundo pase cuando existan los `SLOT_*`). Prerrequisitos ya
resueltos: CMP de Google publicado (§4.1) y `ads.txt`/`app-ads.txt` servidos
(§2). La web pasó de "Preparando" a la revisión de AdSense con este deploy.
Issue de seguimiento: #382 (relacionadas: #250 CLS, #254 analítica de anuncios,
#246 consentimiento).*

AdMob **no aplica** a la web/PWA: es exclusivo de apps nativas. La red elegida es
**Google AdSense** (mismo ecosistema, soporte web). En la **app móvil** sí se usa
AdMob: ver [§6](#6-admob--app-mvil).

---

## 1. Variables de entorno

Todas viven en `/opt/sticklive/.env.prod` (plantilla: [`.env.prod.example`](../.env.prod.example)).
`NEXT_PUBLIC_*` son variables de **BUILD**: se hornean en el bundle al construir.

| Variable | Qué es | Vacío / `0` |
|---|---|---|
| `NEXT_PUBLIC_ADSENSE_CLIENT` | **Interruptor maestro**: `ca-pub-…` de la cuenta | Vacío = sin AdSense (cero script, cero huecos) |
| `NEXT_PUBLIC_ADSENSE_SLOT_HOME_TOP` | Id de bloque del banner de portada (arriba) | Sin slot = esa superficie no muestra anuncio |
| `NEXT_PUBLIC_ADSENSE_SLOT_HOME_INLINE` | Id de bloque del banner inline de portada | idem |
| `NEXT_PUBLIC_ADSENSE_SLOT_LIST_INLINE` | Id de bloque del banner entre resultados (requiere `ADS_LIST_EVERY > 0`) | idem |
| `NEXT_PUBLIC_ADSENSE_SLOT_MATCH_SUMMARY` | Id de bloque del banner en el resumen del partido | idem |
| `NEXT_PUBLIC_ADSENSE_SLOT_MATCH_STATS` | Id de bloque del banner en estadísticas | idem |
| `NEXT_PUBLIC_ADSENSE_SLOT_INTERSTITIAL` | Id de bloque del interstitial | idem |
| `NEXT_PUBLIC_ADS_INTERSTITIAL` | `0`/`1`: activa el interstitial | `0` = nunca se muestra |
| `NEXT_PUBLIC_ADS_LIST_EVERY` | Cada cuántos resultados insertar un banner inline (p. ej. `6`) | `0` = ninguno |

> **El client id manda.** Si `NEXT_PUBLIC_ADSENSE_CLIENT` está vacío, el resto de
> valores se ignoran: no se carga el script de AdSense y no se reserva ningún
> espacio de anuncio. Es el modo actual.

---

## 2. Cómo activar

> **ads.txt / app-ads.txt ya publicados (2026-10-06):** `apps/web/public/ads.txt`
> y `apps/web/public/app-ads.txt` contienen la línea de autorización de Google
> (`pub-2994866776026136`) para la web y la app respectivamente. Se sirven en
> `https://sticklive.eu/ads.txt` y `/app-ads.txt` tras desplegar. Sin ads.txt,
> AdSense avisa de "ingresos en riesgo"; es información pública, no un secreto.

1. **Cuenta de AdSense aprobada** y, para cada superficie, un **bloque de
   anuncios** creado en el panel (Anuncios → Por unidad). Anota su `data-ad-slot`.
2. **Rellenar `.env.prod`** (en el VPS, nunca en el repo ni en el chat):
   `NEXT_PUBLIC_ADSENSE_CLIENT=ca-pub-…` y los `SLOT_*` que se vayan a usar.
   Empieza conservador: `NEXT_PUBLIC_ADS_INTERSTITIAL=0`.
3. **Build args ya cableados (hecho).** Las variables están declaradas como
   `ARG` en `deploy/Dockerfile` y como `args:` del servicio `web` en
   `docker-compose.prod.yml` (bloque `&app-build`). Por eso basta con definirlas
   en `.env.prod` y reconstruir. Si algún día se añade una `NEXT_PUBLIC_*` nueva,
   hay que cablearla **en ambos sitios** (Dockerfile + compose) o no tendrá
   efecto: las `NEXT_PUBLIC_*` se hornean en **build**, no en runtime.
4. **Redesplegar con build** (obligatorio: el valor se hornea en el bundle):
   ```bash
   cd /opt/sticklive
   DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
   $DC up -d --build web
   ```
5. **Consentimiento (CMP) antes de servir anuncios en la UE** — ver §4.
6. **Verificar** — ver §3.

---

## 3. Verificación (evidencia, no "parece que va")

**Sin client id (estado por defecto):**

- Abrir la web → DevTools → Network, filtrar por `googlesyndication`: **0
  peticiones**.
- Buscar `adsbygoogle` en el HTML servido: **no aparece**.
- El layout no muestra huecos vacíos de anuncio.

**Con client id:**

- Network muestra la carga de
  `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js` y los
  iframes de `googlesyndication`/`doubleclick`.
- En el inspector, el contenedor del anuncio lleva `data-ad-client="ca-pub-…"`.
- Caddy sirve el CSP de AdSense en **modo observación** (ver
  [operations.md § Dominio, TLS y borde](./operations.md#dominio-tls-y-borde)):
  comprobar en la consola que no hay violaciones nuevas al activar.

**Premium elimina anuncios:**

- Con sesión premium, el componente de anuncio devuelve `null` (cero DOM, cero
  petición) antes de montar nada. Verificarlo con una cuenta premium real.

**Analítica de anuncios (#254):** impresiones/clicks deben emitirse como
`ad_impression` / `ad_click` desde la web. Es parte del agente de web, no esta
guía.

---

## 4. Consentimiento previo (CMP) — obligatorio en la UE

AdSense exige **consentimiento previo** para el Espacio Económico Europeo, Reino
Unido y Suiza. Sin un **CMP certificado por Google (IAB TCF v2.2)** o el CMP
propio de Google (Funding Choices), AdSense **no sirve anuncios personalizados** y
la cuenta puede recibir avisos/sanción por política.

El CMP de Google es la **única** puerta de consentimiento (publicidad y
analítica). El antiguo aviso propio de analítica (`ConsentBanner`, #246) se
retiró el 2026-10-19; ver §4.2.

### 4.1 Decisión: CMP de Google con tres opciones (2026-10-06)

*Estado: **publicado** (2026-10-07, AdSense → Privacidad y mensajes → Reglamentos
europeos, apuntando a sticklive.eu, 32 idiomas). El mensaje se sirve a través del
tag de AdSense cuando este esté activo (§2). El equivalente de la app (AdMob) está
publicado desde el 2026-10-06.*

**Proveedor:** el **CMP propio de Google** (Privacy & messaging / Funding
Choices), certificado IAB TCF v2.2. No se adopta un CMP externo: añadiría
dependencia y coste sin aportar nada, porque Google ya es un CMP certificado y el
script de AdSense acaba de servir anuncios en la misma página.

**Mensaje: tres opciones — `Consentir` · `No consentir` · `Gestionar opciones`.**

- **Rechazar tan fácil como aceptar** (guía EDPB): un botón explícito "No
  consentir" al mismo nivel evita el riesgo de reclamación que tiene esconder la
  negativa dentro del panel.
- Con "No consentir", AdSense sigue sirviendo anuncios **no personalizados**; el
  impacto en ingresos es menor que quedarse sin CMP (pérdida de ads
  personalizados o aviso de política).
- Se descarta la variante de **dos botones** (`Consentir` · `Gestionar opciones`)
  por la ambigüedad de la negativa.
- Al configurarlo **a nivel de cuenta de AdSense**, el mensaje se aplica a
  **todos los sitios presentes y futuros** (sticklive.eu y los que se creen
  después): es exactamente el alcance pedido. El mensaje GDPR/UMP de la app móvil
  (§6) usa el mismo marco.

**Configuración del mensaje (panel):** idioma español por defecto + los locales
publicados de la web (`en`, `pt`, `fr`, `it`); URL de privacidad
`https://sticklive.eu/es/privacy`; opciones de consentimiento por defecto de
Google.

**Verificación (evidencia, no "parece que va"):** con tráfico EEE/UK/Suiza y sin
elección previa, debe aparecer el mensaje con los **tres** botones; al pulsar "No
consentir", no se sirven anuncios personalizados; el estado del CMP (`__tcfapi`)
refleja la elección; en AdSense "Privacidad y mensajes" el CMP figura como
configurado/publicado.

### 4.2 Consentimiento unificado con el CMP de Google + respaldo — hecho (2026-10-19)

La puerta principal es el CMP certificado de Google (Funding Choices, TCF v2.2),
que se sirve a través del tag de AdSense y cubre **publicidad y analítica**.

- **Publicidad** → el CMP decide si los anuncios son personalizados o no.
- **Analítica** → `lib/consent-tcf.ts` lee `__tcfapi` y solo permite PostHog si
  `gdprApplies === false` (fuera del EEE/UK/CH) o si el usuario ha concedido los
  propósitos TCF **1** (almacenar/acceder a información del dispositivo) y **7**
  (medir audiencia).
- **Respaldo** → si el CMP no muestra su mensaje ni publica TCData (mensaje GDPR
  no disponible en AdSense, bloqueador, red), a los ~7 s aparece el aviso de
  analítica propio (`FallbackConsentBanner`, clave histórica
  `rink-consent-analytics`). Solo decide sobre analítica; la publicidad sigue en
  manos del CMP. Una decisión explícita del CMP (conceder o denegar) siempre
  manda sobre el respaldo. Sin CMP y sin respaldo, fail-closed: PostHog no se
  inicializa.
- **Cambiar la elección** → Ajustes → “Publicidad y privacidad” abre
  `googlefc.showRevocationMessage()`; “Analítica y privacidad” (solo si el CMP
  está pendiente o no disponible) reabre el aviso de respaldo.

El tag de AdSense se carga siempre que esté configurado, también para Premium:
es el que publica el CMP. Los usuarios Premium no tienen huecos de anuncio, así
que no se solicita publicidad para ellos.

**Verificación en producción (19/10/2026):** el CMP carga (`__tcfapi`, cmpId 300,
`cmpStatus: loaded`) pero **no muestra mensaje**: `displayStatus: hidden`,
`getTCData` devuelve `success: false` y tampoco aparece con
`?fc=alwaysshow&fctype=gdpr`. El problema está en la configuración del mensaje
GDPR en AdSense → Privacidad y mensajes, no en el código. Mientras se corrige, el
respaldo mantiene operativa la analítica y el CMP sigue gobernando la publicidad
(que se sirve en modo limitado/no personalizado). Los usuarios que ya habían
aceptado o rechazado el aviso antiguo conservan su elección porque la clave es
la misma.

Archivos: `lib/consent-tcf.ts` (TCF + estado combinado), `lib/consent-fallback.ts`
(persistencia del respaldo), `components/shared/FallbackConsentBanner.tsx`,
`lib/analytics.tsx`, `AdsenseScript`, `AdBanner`, `AdInterstitial`, `InstallBanner`
y `instrumentation-client.ts` (Sentry Replay). La política de privacidad se
actualizó en los cinco idiomas para explicar que la analítica se rige por el CMP
de Google o, si no está disponible, por el aviso de respaldo.

---

## 5. Política y UX (evitar sanciones de AdSense / Better Ads)

- **El interstitial no debe tapar contenido al cargar.** Un overlay que cubre la
  pantalla en la carga incumple los *Better Ads Standards* y la política de
  AdSense; es causa típica de sanción. Debe ser **no intrusivo**, descartable con
  un toque, con botón de cierre visible y sin bloquear la navegación ni el directo.
- **Anuncios pequeños, separados del contenido**: banner entre resultados y en el
  resumen, nunca superpuestos a marcadores, resultados en vivo ni botones.
- **Frecuencia**: `NEXT_PUBLIC_ADS_LIST_EVERY` controla cada cuántos resultados
  cae un inline; subirlo (6–8+) antes que bajarlo. El interstitial, apagado al
  principio (`NEXT_PUBLIC_ADS_INTERSTITIAL=0`).
- **Reservar altura** del banner para no provocar CLS (#250): el hueco debe
  existir antes de insertar el anuncio. El usuario premium nunca reserva nada.
- **Etiqueta "PUBLICIDAD"** visible (cumplimiento IAB/CNMC).

---

## 6. AdMob — app móvil

*Estado: **v1 + Plan D IMPLEMENTADO en la app (2026-10-07)** — UMP + banners
adaptativos con gating premium fail-closed (plan
[2026-10-07-app-premium-web-admob](./superpowers/plans/2026-10-07-app-premium-web-admob.md))
y formatos completos con config remota (`GET /ads/config`): rewarded
recompensado (adfree), app open, interstitial al salir de ficha no-live y
native in-feed (plan
[2026-10-07-app-ads-plan-d-formatos-config](./superpowers/plans/2026-10-07-app-ads-plan-d-formatos-config.md)).
La compra es SOLO en la web: la app lee el premium de su sesión
(`GET /payments/status`) y abre sticklive.eu en el navegador del sistema.
Diseño de plazamientos y caps: §7–§8 del
[spec de monetización](./superpowers/specs/2026-10-06-monetizacion-ads-premium-design.md).*

> Los IDs de app y de bloque **no son secretos**: viajan horneados en el APK.
> El **App ID** va horneado en `apps/mobile/app.config.ts` (config plugin,
> Android — el alta iOS es pendiente) y los unit ids de banner viajan como
> variables `EXPO_PUBLIC_*` de build, nunca hardcode en el repo.

| Variable | Bloque | Superficie | ID | Estado |
|---|---|---|---|---|
| — (plugin, `app.config.ts`) | App | manifest Android (`~`) | `ca-app-pub-2994866776026136~4595623578` | v1 |
| `EXPO_PUBLIC_ADMOB_BANNER_LIST` | Banner | Pie de listas (Directo, Clasificación, Búsqueda, Favoritos) | `ca-app-pub-2994866776026136/4268320510` | v1 |
| `EXPO_PUBLIC_ADMOB_BANNER_MATCH` | Banner | Ficha de partido finalizada/por jugar | `ca-app-pub-2994866776026136/2815638044` | v1 |
| — | Nativo avanzado | In-feed cada 6–8 items | `ca-app-pub-2994866776026136/8343296898` | Plan D |
| — | Aplicación abierta | Arranque frío, nunca tras push de gol | `ca-app-pub-2994866776026136/7030215228` | Plan D |
| — | Intersticial | Al salir de ficha finalizada | `ca-app-pub-2994866776026136/8847613791` | Plan D |
| — | Vídeo con recompensa | 30 min sin ads (recompensa: `30` × `adfree_min`) | `ca-app-pub-2994866776026136/6371739675` | Plan D |

Los cuatro formatos **Plan D** tienen su bloque AdMob creado (IDs en la tabla)
y están IMPLEMENTADOS en la app y en el API (`GET /ads/config`), pero nacen
APAGADOS: la activación es por env (tabla abajo) y se decidirá cuando los
banners den datos.

**Envs de activación de los formatos Plan D** — dos capas, ambas necesarias:

1. **Config remota (API)**: se definen en `/opt/sticklive/.env.prod` +
   redespliegue del API. TODAS vacías por defecto = todos los formatos
   apagados (`GET /ads/config` responde `enabled: false`; la app consulta la
   config en runtime, sin rebuild). Parseo estricto: solo `1`/`true` exactos
   activan — un typo NO activa nada.

| Variable | Formato | Efecto |
|---|---|---|
| `ADS_APP_OPEN_ENABLED` | App open | `1`/`true` activa |
| `ADS_INTERSTITIAL_ENABLED` | Interstitial | `1`/`true` activa |
| `ADS_REWARDED_ENABLED` | Rewarded | `1`/`true` activa |
| `ADS_REWARDED_ADFREE_MINUTES` | Rewarded | Minutos de adfree por reward (default 30) |
| `ADS_NATIVE_FEED_ENABLED` | Native in-feed | `1`/`true` activa; `false` o basura apaga AUNQUE el EVERY sea válido |
| `ADS_NATIVE_FEED_EVERY` | Native in-feed | Entero positivo: activa el formato IMPLÍCITAMENTE y fija la cadencia (default 8); un `ADS_NATIVE_FEED_ENABLED` definido tiene la última palabra |

2. **Unit ids (build production de EAS, `EXPO_PUBLIC_*`)**: vacías =
   fail-closed (formato activo en config pero sin bloque: no pide). Misma
   regla que los banners: nunca definirlas fuera del perfil `production`.

| Variable | Formato |
|---|---|
| `EXPO_PUBLIC_ADMOB_APP_OPEN` | App open |
| `EXPO_PUBLIC_ADMOB_INTERSTITIAL` | Interstitial |
| `EXPO_PUBLIC_ADMOB_REWARDED` | Rewarded |
| `EXPO_PUBLIC_ADMOB_NATIVE_FEED` | Native in-feed |

**Nota v1:** los caps que publica la config (`minIntervalHours` del app open,
`minIntervalMinutes`/`maxPerHour` del interstitial) son INFORMATIVOS: la app
gobierna el presupuesto compartido de pantalla completa con constantes
idénticas (`MIN_FULL_SCREEN_INTERVAL_MS` = 20 min, `MAX_FULL_SCREEN_PER_HOUR` =
2, grace period de 2 sesiones, en `apps/mobile/src/lib/ads/fullscreen.ts`).
Cablear que la app respete los valores de la config es un follow-up.

**Regla de IDs (v1, implementada en `AdBanner.tsx`):** en `__DEV__` SIEMPRE los
IDs de prueba de Google (hardcodeados vía `TestIds.BANNER`); los reales SOLO se
definen como variables en el perfil `production` de EAS. En dev/preview van
vacías → fail-closed (sin banner). **Clicar en anuncios reales dentro de builds
de prueba es causa de baneo** — nunca definir los ids reales fuera de `production`.

| Formato | ID de prueba |
|---|---|
| Banner | `ca-app-pub-3940256099942544/6300978111` |
| Nativo avanzado | `ca-app-pub-3940256099942544/2247696110` |
| Aplicación abierta | `ca-app-pub-3940256099942544/3419835294` |
| Intersticial | `ca-app-pub-3940256099942544/1033173712` |
| Recompensado | `ca-app-pub-3940256099942544/5224354917` |

**Checklist antes de tráfico real** (bloqueos para activar banners y formatos
Plan D en `production`):

- [x] **Re-consentimiento en Ajustes** (Plan D Task 3, 2026-10-07): entrada de
  "privacidad de anuncios" que vuelve a abrir el formulario UMP
  (`manageAdsConsent`) — la policy de Google exige que el usuario pueda cambiar
  su consentimiento después de la primera vez.
- [ ] **Proguard**: si algún día se activa `minifyEnabled` en Android, añadir
  las reglas keep del SDK de consentimiento (`consent_sdk`/UMP:
  `-keep class com.google.android.ump.** { *; }`) — el paquete no trae consumer
  rules propios.
- [ ] **Smoke en device con license testers** de AdMob — **PENDIENTE DE UN
  HUMANO** (requiere development build; Expo Go no sirve para ads). Cubre
  banners Y los cuatro formatos Plan D: 1) sesión no premium → banners de TEST
  visibles tras el consentimiento UMP; 2) cuenta premium → cero banner y cero
  petición a AdMob (verificar en el log de Metro); 3) ficha EN VIVO → sin
  banner ni interstitial, finalizada → banner y interstitial al salir; 4) sin
  consentimiento UMP → sin ads de ningún formato; 5) rewarded → el "complete"
  otorga el adfree elegido (acumulable) y un fallo no concede nada; 6) app
  open → solo arranque frío (nunca tras push, nunca en las 2 primeras
  sesiones, máx 2/hora y 20 min compartidos con el interstitial); 7) native
  in-feed → UN item nativo por pantalla, tras el item N en Directo/Clasificación (decisión v1: un solo native simultáneo; "cada N a lo largo de la lista" es iteración posterior), legible también en dark
  mode. Para forzar el formulario UMP (p. ej. simular EEA):
  `requestAdsConsent({ debugGeography, testDeviceIdentifiers })` —
  `consent.ts` acepta las opciones del SDK y no las cocina.
- [ ] **Telemetría** de monetización (Plan D): evento `onPaid` en el servidor y
  su explotación — sin datos de ingresos no se decide la iteración de formatos.

**Pendiente fuera del repo:** solo vincular la app a su ficha de Play (cuando
exista, tarea del release M5). El **mensaje GDPR/UMP** está creado y publicado
(2026-10-06) en Privacidad y mensajes — equivalente al CMP web de §4, idioma
español por defecto + 4 adicionales, opciones de consentimiento por defecto,
URL de privacidad de la web. El **app-ads.txt** ya está publicado (ver §2).

## 7. Producto premium (Stripe): anual y "para siempre"

**Dos productos, un solo entitlement** (`users`: `premium_until` para el anual,
`premium_lifetime` para el pago único; el guard `isUserPremium` los une).

| Producto | Precio | Env | Efecto en el webhook |
|---|---|---|---|
| Anual | 4,99 € (default) | `PREMIUM_PRICE_EUR_CENTS=499` | `premium_until = GREATEST(actual, NOW()) + 1 año` |
| Para siempre | 29,99 € (default) | `PREMIUM_LIFETIME_PRICE_EUR_CENTS=2999` | `premium_lifetime = TRUE` (**nunca** toca `premium_until`) |

**Flujo:** el paywall de la web (`/settings`, `PremiumBanner`) ofrece las dos
opciones → `POST /payments/stripe/checkout {deviceId, product}` (`product`:
`annual` | `lifetime`; ausente = `annual` por compatibilidad) → Stripe Checkout
(precio inline, sin Product/Price en el panel) → webhook idempotente
(`processed_stripe_events`) → entitlement. La app solo LEE el estado
(`GET /payments/status`).

**Fail-closed (dinero):** producto inválido en el checkout → `400
unknown_product`; producto presente-pero-desconocido en el webhook → **no se
concede nada** + error a Sentry (el evento se acusa con 200 para no provocar
reintentos en bucle). `POST /restore` (por email) concede **lifetime si existe**,
si no el anual.

**Cambiar el precio:** una env en `/opt/sticklive/.env.prod` + recrear el API
(`$DC up -d api`; no hace falta rebuild). Con `deploy.sh` también vale.

### Activar la venta

Checklist REAL (verificada) para pasar de "paywall oculto" a cobrar de verdad:

1. **Claves Stripe live** en `.env.prod` (en el VPS): `STRIPE_SECRET_KEY` y
   `STRIPE_WEBHOOK_SECRET`. **Nunca** en el repo ni en el chat. Sin
   `STRIPE_SECRET_KEY`, el checkout responde **500** (`STRIPE_SECRET_KEY no
   configurada`).
2. **Webhook** en el dashboard de Stripe (Developers → Webhooks): endpoint
   `https://sticklive.eu/api/payments/stripe/webhook`, evento
   `checkout.session.completed`; copia su signing secret a `STRIPE_WEBHOOK_SECRET`.
3. **Flags del paywall web** en `.env.prod`: `NEXT_PUBLIC_PREMIUM_ENABLED=1` (y
   `NEXT_PUBLIC_PAYMENT_PROVIDER=stripe`) y **rebuild del web** — son variables de
   **BUILD** (`NEXT_PUBLIC_*`): recrear el contenedor no basta, hay que
   `--build` para hornearlas.
4. **Precios** (si se cambian): `PREMIUM_PRICE_EUR_CENTS` / `PREMIUM_LIFETIME_PRICE_EUR_CENTS`
   en `.env.prod` + recrear el API.
5. **Verificación:** en `/settings`, click anual → 4,99 €, click lifetime → 29,99 €;
   un pago real de prueba → badge de premium activo y sin ads.

**Estado actual de producción:** sin las claves, el checkout responde 500; con
`NEXT_PUBLIC_PREMIUM_ENABLED=0` el paywall ni se muestra (la app es gratis).

## 8. Referencias

- `.env.prod.example` — plantilla de variables.
- `deploy/Caddyfile` — CSP en modo observación con hosts de AdSense.
- [operations.md](./operations.md) — operación del borde y despliegue.
- Issues: #382 (config/negocio + CMP), #250 (CLS/placeholder), #254 (analítica de
  ads), #246 (consentimiento de analítica).
