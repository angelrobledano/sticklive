# Monetización — publicidad web (Google AdSense) y premium

*Estado: **listo pero apagado**. La web solo carga anuncios si
`NEXT_PUBLIC_ADSENSE_CLIENT` está definido; por defecto está vacío y no hay
ninguna petición a Google. Issue de seguimiento: #382 (relacionadas: #250 CLS,
#254 analítica de anuncios, #246 consentimiento).*

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

El aviso de consentimiento actual (`ConsentBanner`, #246) cubre **solo
analítica**, no publicidad: no es un CMP certificado. **No basta** para ads.

### 4.1 Decisión: CMP de Google con tres opciones (2026-10-06)

*Estado: **decidido**, pendiente de configurar y publicar en el panel de
AdSense. Lo aplica el coordinador en "Privacidad y mensajes"; esta guía no
ejecuta pasos de panel.*

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

### 4.2 Separación de las dos puertas — hecho (2026-10-06)

El mensaje del CMP de Google se sirve **a través del tag de AdSense**. Antes, el
tag solo se cargaba si el usuario había aceptado el aviso de **analítica**
(`useAdConsent()` → `lib/consent.ts`), con lo que el CMP no podía mostrarse a
quien no la aceptaba y el consentimiento publicitario nunca llegaba a pedirse.

Ya está **desacoplado** (código + tests):

- **Analítica** → `ConsentBanner` (#246) sigue gobernando PostHog.
- **Publicidad** → el CMP de Google (TCF) gobierna el consentimiento y el tipo de
  anuncio dentro del propio tag; `adsEnabled()` ya no depende del consentimiento
  de analítica.

Archivos: `apps/web/src/lib/ads.ts` (se elimina `useAdConsent` y el parámetro
`consentGranted` de `adsEnabled` y `shouldShowInterstitial`) y sus tres
consumidores (`AdsenseScript`, `AdBanner`, `AdInterstitial`). Cubierto por
`apps/web/src/lib/ads.test.ts`.

**Hecho también (2026-10-06):** la política de privacidad
(`apps/web/src/app/[locale]/privacy/page.tsx`, ES + EN) ya describe la
publicidad, sus cookies y el consentimiento (nueva sección "Publicidad" /
"Advertising") y deja de afirmar "no usamos cookies publicitarias"; también
actualiza la fecha de revisión.

**Pendiente antes de activar:** no activar el client id en producción con
tráfico UE hasta que el CMP esté configurado y publicado en el panel.

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

*Estado: **creados (2026-10-06)**, pendiente de que exista `apps/mobile` que los
consuma (hitos M1+ del [spec de monetización](./superpowers/specs/2026-10-06-monetizacion-ads-premium-design.md)).
Diseño de plazamientos y caps: §7–§8 del mismo spec.*

> Los IDs de app y de bloque **no son secretos**: viajan horneados en el APK.
> Igual que en web, van como variables `EXPO_PUBLIC_*` (build), nunca hardcode.

| Variable (`EXPO_PUBLIC_*`) | Bloque | Superficie | ID |
|---|---|---|---|
| `ADMOB_APP_ID` | App | manifest Android (`~`) | `ca-app-pub-2994866776026136~4595623578` |
| `ADMOB_BANNER_LIST` | Banner | Pie de listas (Directo, Clasificación, Búsqueda, Favoritos) | `ca-app-pub-2994866776026136/4268320510` |
| `ADMOB_BANNER_MATCH` | Banner | Ficha de partido finalizada/por jugar | `ca-app-pub-2994866776026136/2815638044` |
| `ADMOB_NATIVE_FEED` | Nativo avanzado | In-feed cada 6–8 items | `ca-app-pub-2994866776026136/8343296898` |
| `ADMOB_APP_OPEN` | Aplicación abierta | Arranque frío, nunca tras push de gol | `ca-app-pub-2994866776026136/7030215228` |
| `ADMOB_INTERSTITIAL` | Intersticial | Al salir de ficha finalizada | `ca-app-pub-2994866776026136/8847613791` |
| `ADMOB_REWARDED` | Vídeo con recompensa | 30 min sin ads (recompensa: `30` × `adfree_min`) | `ca-app-pub-2994866776026136/6371739675` |

**Perfiles EAS:** `development` y `preview` usan los **IDs de prueba de Google**
(hacer clic en ads reales en builds de prueba es causa de baneo); los reales
solo en `production`:

| Formato | ID de prueba |
|---|---|
| Banner | `ca-app-pub-3940256099942544/6300978111` |
| Nativo avanzado | `ca-app-pub-3940256099942544/2247696110` |
| Aplicación abierta | `ca-app-pub-3940256099942544/3419835294` |
| Intersticial | `ca-app-pub-3940256099942544/1033173712` |
| Recompensado | `ca-app-pub-3940256099942544/5224354917` |

**Pendiente fuera del repo:** solo vincular la app a su ficha de Play (cuando
exista, tarea del release M5). El **mensaje GDPR/UMP** está creado y publicado
(2026-10-06) en Privacidad y mensajes — equivalente al CMP web de §4, idioma
español por defecto + 4 adicionales, opciones de consentimiento por defecto,
URL de privacidad de la web. El **app-ads.txt** ya está publicado (ver §2).

## 7. Referencias

- `.env.prod.example` — plantilla de variables.
- `deploy/Caddyfile` — CSP en modo observación con hosts de AdSense.
- [operations.md](./operations.md) — operación del borde y despliegue.
- Issues: #382 (config/negocio + CMP), #250 (CLS/placeholder), #254 (analítica de
  ads), #246 (consentimiento de analítica).
