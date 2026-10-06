# Diseño — Monetización: publicidad (AdSense web / AdMob app) y premium (Stripe + Google Play)

Fecha: 2026-10-06
Estado: Diseño aprobado en brainstorming; pendiente plan de implementación.

## 1. Contexto y objetivo

Stick Live activa su monetización: publicidad en web (Google AdSense, ya
construida y apagada tras flag) y en la app móvil (Google AdMob, nueva), más el
premium que las elimina. El premium se compra por dos vías: Stripe en la web
(ya funciona) y Google Play Billing dentro de la app (nuevo).

Este diseño **enmienda** el spec de la app móvil
([2026-10-05-app-movil-design.md](./2026-10-05-app-movil-design.md)), que
decidía "premium fuera de la app v1": el usuario ha decidido que publicidad y
compra entren **en la v1** de la app.

## 2. Decisiones tomadas

| Decisión | Elección |
|---|---|
| Red publicitaria web | **AdSense** (ya implementada, apagada; [docs/monetizacion.md](../../docs/monetizacion.md)) |
| Red publicitaria app | **AdMob** vía `react-native-google-mobile-ads` (requiere development build, ya previsto) |
| Venta en la app | **Sí**: Google Play Billing con `react-native-iap` y **validación propia en la API** (sin RevenueCat ni terceros en la ruta de ingresos) |
| Productos en Play | **Suscripción anual** (`premium_annual`, paridad con web) + **compra única** no consumible (`premium_lifetime`, "para siempre") |
| Compra ligada a cuenta | **Requiere sesión iniciada**: el entitlement es de la cuenta Stick Live y viaja entre web y app |
| Renovaciones de Play | **Job diario en el ETL** (mismo patrón que push-dispatcher); sin RTDN/Pub/Sub en v1 |
| Consentimiento app | **UMP SDK** de Google (CMP certificado para apps) antes de inicializar AdMob en EEE/UK/Suiza |
| Intersticiales | **Sin intersticiales en v1** (misma prudencia que web: `ADS_INTERSTITIAL=0`) |
| Secuencia | Todo en la v1 de la app (decisión del usuario; revisión de Play asume el riesgo) |

## 3. Principio rector: un entitlement, dos vías de cobro, tres superficies

- La verdad vive en una sola tabla (`users`): si la cuenta es premium, no hay
  publicidad en ninguna superficie.
- Vías de cobro: **Stripe** (web) y **Google Play Billing** (app).
- Superficies: web (AdSense) y app (AdMob). Ninguna decide su estado por su
  cuenta: todas consultan el mismo guard de la API.
- AdMob y AdSense no interactúan entre sí: cada red vive en su plataforma y solo
  comparten la condición de cuenta que las apaga.

## 4. Modelo de datos (migración aditiva e idempotente)

- `users.premium_lifetime BOOLEAN NOT NULL DEFAULT FALSE` — el pago único.
- `isPremiumActive()` (`apps/api/src/lib/premium.ts`) pasa a ser:
  `premium_lifetime || premium_until > NOW()`. Sigue siendo el **guard único**
  (auditoría S9): una sola regla de exclusión de ads para todas las superficies.
- Tabla `play_purchases`:
  - `user_id`, `product_id` (`premium_annual` | `premium_lifetime`),
    `purchase_token` con **índice único** (idempotencia, patrón
    `processed_stripe_events`), `order_id`, `state`, `expires_at` (NULL en
    lifetime), `created_at`, `updated_at`.
- Acumulación natural: anual por web + lifetime en app coexisten en la misma
  cuenta; el guard las trata como OR.

## 5. API — verificación de compras

**`POST /payments/play/verify`** — requiere sesión.

1. La app envía `purchaseToken` + `productId`.
2. La API valida contra la **Google Play Developer API** con service account:
   - Suscripción: `purchases.subscriptionsv2.get`.
   - Compra única: `purchases.products.get`.
3. Se comprueba: `packageName` correcto, producto esperado, estado
   `purchased`/activo, y que el token no esté ya vinculado a **otra** cuenta
   (409 explícito).
4. Concesión:
   - Anual → `premium_until` extendido a la fecha de expiración devuelta por
     Play.
   - Lifetime → `premium_lifetime = TRUE`.
5. Se registra en `play_purchases` y se emite `premium_purchase_completed` con
   `provider: 'play'` (mismo evento que Stripe; la analítica distingue por
   provider).
6. Fallos **siempre explícitos** (Google caído → 502; producto no esperado →
   422; token reutilizado → 409). Nunca silencio: "los malos datos son peores
   que no tener datos".

## 6. Job diario — reconciliación con Play

`play-reconciler` en el ETL (cron, mismo patrón que push-dispatcher):

- Para cada `play_purchases` de tipo suscripción activa: revalida contra
  `subscriptionsv2.get`.
  - Renovada → extiende `premium_until` a la nueva `expires_at`.
  - Expirada/revocada → no toca `premium_until`; el guard la excluye al
    quedar en el pasado.
- Reembolsos de lifetime: consulta `voidedpurchases` → `premium_lifetime =
  FALSE` con log explícito.
- Cada acción queda registrada en logs; el estado de `play_purchases` se
  actualiza en la misma transacción que la concesión/revocación.

## 7. App móvil

- **Compra** (pantalla en Ajustes, solo con sesión):
  1. `react-native-iap`: `initConnection`, productos por id,
     `purchaseUpdatedListener` + `purchaseErrorListener`.
  2. Compra → token → `POST /payments/play/verify` → `acknowledgePurchase` solo
     tras verify OK → refresco de estado.
  3. Dos productos: anual y "para siempre".
- **Estado premium:** equivalente de `PremiumContext` de la web — endpoint de
  estado que devuelve `premium_active`, `premium_lifetime`, `premium_until` y
  `source`. Si es premium, **AdMob no se inicializa** (cero SDK, cero petición;
  paridad con el `null` del componente web).
- **Anuncios:** banners en listado de partidos y ficha (nunca superpuestos al
  marcador ni a botones), etiqueta "PUBLICIDAD", reserva de altura para evitar
  CLS. Sin intersticiales en v1.
- **Consentimiento:** UMP SDK antes de cualquier inicialización de AdMob para
  EEE/UK/Suiza. Si el usuario rechaza el almacenamiento/uso, AdMob no se
  inicializa; si elige "anuncios no personalizados", se sirven solo NPA. Sin
  anuncio servible, la superficie se colapsa (cero hueco reservado).

## 8. Web — cambios de código

**Ninguno.** AdSense ya está implementada, apagada y documentada (variables,
CMP, verificación). El premium comprado en la app elimina los ads web porque
ambas superficies comparten `isPremiumActive`. La activación de AdSense en
producción sigue su propia guía ([docs/monetizacion.md](../../docs/monetizacion.md))
y queda fuera del alcance de este diseño.

## 9. Prerrequisitos manuales (fuera del repo)

- Cuenta de Google Play Console con la app creada y los **dos productos**
  dados de alta (suscripción anual; producto in-app no consumible).
- **Service account** en Google Cloud con acceso a la Play Developer API
  (vinculada en Play Console → API access) y credenciales en `.env.prod`
  (nunca en el repo ni en el chat).
- **License testers** configurados en Play Console para probar compras en modo
  test.
- Cuenta de AdMob con app registrada y bloques de anuncios creados
  (paralelo a los slots de AdSense). **Hecho (2026-10-06):** app + 6 bloques
  registrados en [docs/monetizacion.md §6](../../docs/monetizacion.md#6-admob--app-mvil).
  Mensaje GDPR/UMP creado y publicado (2026-10-06). Pendiente: vincular a Play
  cuando exista la ficha (tarea del release M5).

## 10. Testing (priorizado según AGENTS.md)

- **P0:**
  - `/verify` idempotente: mismo `purchase_token` dos veces → un solo premium.
  - Token vinculado a otra cuenta → 409; `packageName`/producto inesperado →
    rechazo explícito.
  - Lifetime concede permanentemente; expiración excluye del guard
    (`isPremiumActive` con y sin `premium_lifetime`).
  - Reconciliador: extiende al renovar, excluye al expirar, revoca lifetime
    reembolsado (mock de la Play Developer API + integración contra Postgres
    real).
- **P1:** flujo de compra end-to-end con license testers; UMP bloquea ads sin
  consentimiento en EEE; premium → cero inicialización de AdMob.
- **P2:** banner colapsa siendo premium; estados de error de compra (cancelada,
  pendiente, fallida) con copy claro.

## 11. Hitos previstos para el plan

1. **Migración + guard:** `premium_lifetime`, `play_purchases`,
   `isPremiumActive` actualizado.
2. **Verificación:** `POST /payments/play/verify` + service account (validado
   con purchase token de prueba).
3. **Reconciliación:** job diario en el ETL.
4. **App — compra:** pantalla premium, `react-native-iap`, acknowledge,
   refresco de estado.
5. **App — anuncios:** UMP + AdMob + banners (solo si no premium).
6. **Cierre:** verificación end-to-end con license testers, i18n de las nuevas
   pantallas, analítica del funnel premium en la app (mismos nombres de evento
   que la web, `provider` distingue vía).

## 12. Limitaciones y riesgos

- La reconciliación diaria admite una desviación máxima de ~24 h entre lo que
  Play cobra y `premium_until`. Caso límite: si la suscripción renueva el día
  exacto de expiración y el job corre después, puede haber una ventana de unas
  horas con publicidad hasta la reconciliación. Mitigación en el plan: cuando
  Play confirma auto-renew activo, el reconciliador (o el propio verify) puede
  extender `premium_until` con un pequeño buffer; nunca al revés (el guard no
  debe conceder sin validación).
- Sin RTDN en v1: si el job diario falla, los logs explícitos del cron deben
  hacerlo visible (mismo criterio que el resto de jobs del ETL).
- La revisión de Google Play con billing + publicidad en el primer envío puede
  requerir ajustes de ficha (formulario de datos, política de anuncios); se
  resuelve en la fase de release.
- La verificación depende de la Play Developer API: caídas de Google → verify
  falla explícito y la app ofrece reintentar; nunca se concede premium sin
  validación.
- AdMob en Expo Go no funciona: requiere development build (ya decidido en el
  spec de la app; sin coste adicional).

## 13. Referencias

- [docs/monetizacion.md](../../docs/monetizacion.md) — AdSense web, CMP,
  verificación.
- [2026-10-05-app-movil-design.md](./2026-10-05-app-movil-design.md) — spec de
  la app móvil (enmiendado en §1 de este diseño).
- `apps/api/src/lib/premium.ts`, `apps/api/src/routes/payments-stripe.ts`,
  `packages/db/src/queries/users.ts` — patrón actual de premium y webhook
  idempotente.
