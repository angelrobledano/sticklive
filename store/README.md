# Stick Live en Google Play y App Store

Todo lo que piden las dos tiendas para publicar la app con la marca nueva (La i): imágenes, textos en los cinco idiomas de la app, formularios de privacidad y clasificación, y la lista de lo que todavía bloquea el envío.

## Qué hay en esta carpeta

```text
store/
  README.md                       este documento
  fichas.md                       todos los textos de ficha, legibles y con recuento
  politica-de-privacidad-app.md   secciones que faltan en /privacy (app, anuncios, borrar cuenta)
  google-play/
    metadata/<idioma>/            textos, gráfico destacado y notas de versión (formato fastlane supply)
    metadata/es-ES/images/        icon.png 512×512 y phoneScreenshots/ 1080×1920
    seguridad-de-datos.md         respuestas del formulario de seguridad de los datos
    contenido-de-la-app.md        anuncios, IARC, público objetivo, ID de publicidad y ficha
  app-store/
    store.config.json             ficha completa para `eas metadata:push`
    app-icon-1024.png             el mismo icono que va dentro del build
    screenshots/es-ES/iphone-6.9/ 1320×2868
    screenshots/es-ES/iphone-6.3/ 1206×2622
    privacidad.md                 etiquetas de privacidad
    clasificacion-por-edad.md     cuestionario de edad
  marca/                          SVG maestros: la i, logotipo, lockups y capas del icono
```

## Qué he cambiado en el repo

App (`apps/mobile`):

- `assets/`: los iconos y el splash de la plantilla de Expo se sustituyen por la i. Son `icon.png`, `android-icon-foreground.png`, `android-icon-background.png`, `android-icon-monochrome.png`, `splash-icon.png` y `favicon.png`.
- `assets/`: tres ficheros nuevos, `ios-icon-dark.png`, `ios-icon-tinted.png` y `notification-icon.png`.
- `app.config.ts`:
  - El granate pasa de `#7f1d1d` a `#9E1235` en el splash y en el icono adaptativo, y de `#991b1b` a `#9E1235` en el color de las notificaciones.
  - Se añaden los iconos oscuro y tintado de iOS, el icono monocromo de Android 13 y el icono de notificación.
  - Todo esto necesita un build nuevo: no llega por OTA.

Web (`apps/web`):

- `src/lib/og-brand.tsx`: nuevo. Contiene el lockup de la i y los colores de marca para las imágenes sociales.
- Las imágenes OG de partido, competición, equipo y jugador llevan ahora el lockup en lugar del punto rojo con «STICK LIVE», y una franja granate abajo. En partido, el «EN DIRECTO» lleva el punto verde.
- La imagen del cinco inicial (`lineup-image`) estrena la misma cabecera.
- `public/og-image-v2.png`: nueva imagen social por defecto.
  - Lleva otro nombre porque `og-image.png` se sirve con `immutable` y un año de caché. Con el mismo nombre, WhatsApp, X y compañía seguirían enseñando la antigua.
  - `seo.ts`, `next.config.mjs` y `seo.test.ts` apuntan ya al nombre nuevo.
  - `og-image.png` ya no la usa nadie y se puede borrar.

## Antes de enviar: lo que bloquea

Por orden de riesgo. Los dos primeros harían rechazar la app en las dos tiendas.

1. **Comprar Premium en la web desde la app.** El botón «Comprar en la web» de `app/settings/premium.tsx` lleva a pagar con Stripe una función digital (quitar anuncios).
   - Google Play solo lo permite dentro de sus programas de enlaces externos del EEE, que exigen alta y comisión.
   - En el App Store de España está prohibido salvo con el permiso de enlace externo de la UE.
   - Lo más rápido es esconder la oferta en los builds de tienda y dejar solo el estado («Premium activo»). El anuncio recompensado puede quedarse.
2. **Borrar la cuenta.** Como la app crea cuentas (login con Google), las dos tiendas exigen poder borrarla.
   - Google Play pide una ruta dentro de la app y una URL web.
   - Apple pide que el borrado se pueda hacer desde la app: no vale solo escribir un email.
   - Hace falta un `DELETE /auth/account` en el API, un botón en Ajustes y la sección de la política de privacidad (texto listo en `politica-de-privacidad-app.md`).
3. **Política de privacidad.** Tiene que cubrir AdMob, Sentry, las notificaciones de la app y el borrado de cuenta. El texto está en `politica-de-privacidad-app.md`.
4. **Cabecera y botón de volver.** El `Stack` raíz tiene `headerShown: false`. Por eso la ficha de partido y las pantallas de ajustes no tienen cabecera ni botón de volver, y su contenido arranca bajo la barra de estado. Las capturas muestran la cabecera que ya definen esas pantallas (`Stack.Screen options`). Hay que activarla para que la app coincida con ellas.
5. **Iniciar sesión con Apple (solo iOS).** La norma 4.8 obliga a ofrecerlo si hay login con Google.
6. **El balón de fútbol.** El gol usa ⚽ en `EventRow.tsx` y en `playerGoalAlert` (`apps/api/src/lib/notification-copy.ts`).
   - Las capturas usan 🏑 (stick y bola), que es lo que propongo.
   - El aviso nativo de las capturas va sin el prefijo `[Stick Live]`, porque el sistema ya enseña el nombre de la app.
   - Son dos cambios pequeños que dejan app y capturas iguales.
7. **AdMob en iOS.** Falta el `iosAppId` (sin él, el build de iOS se cierra al abrir) y decidir si se pide permiso de rastreo (ver `app-store/privacidad.md`).

## Google Play, paso a paso

1. Prerrequisitos de `docs/app.md`:
   - cuenta de Play Console;
   - `eas login` y `npx eas init` en `apps/mobile`;
   - cuenta de servicio para `eas submit`.
2. Crea la app y rellena la ficha con `google-play/metadata/`:
   - icono 512;
   - gráfico destacado por idioma;
   - 6 capturas en `es-ES`;
   - textos de los cinco idiomas.
3. Contenido de la app: `google-play/contenido-de-la-app.md` y `google-play/seguridad-de-datos.md`.
4. Build y prueba interna: `npx eas build -p android --profile preview` y `npx eas submit -p android --id <buildId>`.
5. Si tu cuenta de desarrollador es personal, la producción exige antes una prueba cerrada con al menos 12 testers durante 14 días (detalle en `contenido-de-la-app.md`).

## App Store, paso a paso

1. Prerrequisitos:
   - cuenta de Apple Developer;
   - los puntos 5 y 7 de arriba;
   - `bundleIdentifier` `eu.sticklive.app` registrado.
2. Copia `app-store/store.config.json` a `apps/mobile/` y completa el teléfono de contacto en `review.phone`. Antes de subirlo, revisa el copyright (`2026 Ángel Robledano`) y el nombre de contacto.
3. `npx eas metadata:push` sube nombre, subtítulo, descripción, palabras clave, URL, categorías, clasificación y notas para el revisor.
4. Las capturas se suben a mano en App Store Connect: `screenshots/es-ES/iphone-6.9/` en «iPhone 6,9"» y `iphone-6.3/` en «iPhone 6,3"». La app no admite iPad (`supportsTablet: false`), así que no hacen falta capturas de iPad.
5. Rellena a mano la privacidad (`privacidad.md`) y las preguntas nuevas de edad (`clasificacion-por-edad.md`).

## Sobre las capturas

Todavía no hay ningún build, así que las capturas reproducen las pantallas reales de `apps/mobile` con datos de ejemplo:

- mismas clases de NativeWind, textos sacados de `es.json` y cabeceras nativas de cada sistema;
- partidos, clasificación y jugadores inventados;
- equipos sin escudo, que es como se ve la app cuando falta el logo.

Google pide enseñar la app real. Cuando tengas el primer build de prueba, sustituye cada pantalla por una captura de verdad manteniendo el marco y el titular.

## Opcional, para cuando toque

- El splash usa la configuración antigua (`splash` en `app.config.ts`), que Expo marca como heredada. Para pasar a la recomendada:
  1. `npx expo install expo-splash-screen`;
  2. en `plugins`, `["expo-splash-screen", { "image": "./assets/splash-icon.png", "imageWidth": 160, "backgroundColor": "#9E1235", "dark": { "image": "./assets/splash-icon.png", "backgroundColor": "#0B1220" } }]`;
  3. borrar la clave `splash`.
- Para el icono de iOS 26 con Icon Composer, las capas están en `marca/` (`icon-capa-fondo.svg`, `icon-capa-stick.svg` y `icon-capa-bola.svg`).
- El modo oscuro de la app deja la cabecera y la barra de pestañas en blanco, porque no se pasa un tema de navegación oscuro a expo-router. Arréglalo antes de enseñar capturas en oscuro.
- La interfaz de la app sigue con el granate anterior: el token `rink-passion` de `tailwind.config.ts` es `#991b1b`, y ese mismo color va suelto en la pestaña activa, el botón de seguir y el canal de avisos de `push.ts`. Las capturas ya usan el de la marca, `#9E1235`. A simple vista casi no se distinguen, pero conviene igualarlos.
- La web mantiene el favicon y los iconos de la PWA con el isotipo anterior: `src/app/icon.svg`, `src/app/apple-icon.png` y `public/icon-*.png`.
