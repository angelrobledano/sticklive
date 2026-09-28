# Monetización — publicidad web (Google AdSense) y premium

*Estado: **listo pero apagado**. La web solo carga anuncios si
`NEXT_PUBLIC_ADSENSE_CLIENT` está definido; por defecto está vacío y no hay
ninguna petición a Google. Issue de seguimiento: #382 (relacionadas: #250 CLS,
#254 analítica de anuncios, #246 consentimiento).*

AdMob **no aplica** a la web/PWA: es exclusivo de apps nativas. La red elegida es
**Google AdSense** (mismo ecosistema, soporte web).

---

## 1. Variables de entorno

Todas viven en `/opt/sticklive/.env.prod` (plantilla: [`.env.prod.example`](../.env.prod.example)).
`NEXT_PUBLIC_*` son variables de **BUILD**: se hornean en el bundle al construir.

| Variable | Qué es | Vacío / `0` |
|---|---|---|
| `NEXT_PUBLIC_ADSENSE_CLIENT` | **Interruptor maestro**: `ca-pub-…` de la cuenta | Vacío = sin AdSense (cero script, cero huecos) |
| `NEXT_PUBLIC_ADSENSE_SLOT_BANNER` | Id de bloque del banner pequeño | Sin slot = esa superficie no muestra anuncio |
| `NEXT_PUBLIC_ADSENSE_SLOT_INLINE` | Id de bloque del banner inline entre resultados | idem |
| `NEXT_PUBLIC_ADSENSE_SLOT_SUMMARY` | Id de bloque del banner en el resumen | idem |
| `NEXT_PUBLIC_ADSENSE_SLOT_STATS` | Id de bloque del banner en estadísticas | idem |
| `NEXT_PUBLIC_ADSENSE_SLOT_INTERSTITIAL` | Id de bloque del interstitial | idem |
| `NEXT_PUBLIC_ADS_INTERSTITIAL` | `0`/`1`: activa el interstitial | `0` = nunca se muestra |
| `NEXT_PUBLIC_ADS_LIST_EVERY` | Cada cuántos resultados insertar un banner inline (p. ej. `6`) | `0` = ninguno |

> **El client id manda.** Si `NEXT_PUBLIC_ADSENSE_CLIENT` está vacío, el resto de
> valores se ignoran: no se carga el script de AdSense y no se reserva ningún
> espacio de anuncio. Es el modo actual.

---

## 2. Cómo activar

1. **Cuenta de AdSense aprobada** y, para cada superficie, un **bloque de
   anuncios** creado en el panel (Anuncios → Por unidad). Anota su `data-ad-slot`.
2. **Rellenar `.env.prod`** (en el VPS, nunca en el repo ni en el chat):
   `NEXT_PUBLIC_ADSENSE_CLIENT=ca-pub-…` y los `SLOT_*` que se vayan a usar.
   Empieza conservador: `NEXT_PUBLIC_ADS_INTERSTITIAL=0`.
3. **Declarar las variables como build args del servicio `web`** en
   `docker-compose.prod.yml` (bloque `args:` de `&app-build`, junto a
   `NEXT_PUBLIC_POSTHOG_KEY`, etc.). **Mientras no estén ahí, definir las
   variables en `.env.prod` no tiene ningún efecto** (issue #382; este paso lo
   aplica el coordinador, no la guía).
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

- El aviso de consentimiento actual (`ConsentBanner`, #246) cubre **solo
  analítica**, no publicidad: no es un CMP certificado. **No basta** para ads.
- La política de privacidad hoy dice "no usamos cookies publicitarias"
  (`apps/web/src/app/[locale]/privacy/page.tsx`): hay que actualizarla antes de
  activar anuncios.
- Planificar el CMP junto con la activación; no activar el client id en
  producción con tráfico UE hasta tenerlo.

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

## 6. Referencias

- `.env.prod.example` — plantilla de variables.
- `deploy/Caddyfile` — CSP en modo observación con hosts de AdSense.
- [operations.md](./operations.md) — operación del borde y despliegue.
- Issues: #382 (config/negocio + CMP), #250 (CLS/placeholder), #254 (analítica de
  ads), #246 (consentimiento de analítica).
