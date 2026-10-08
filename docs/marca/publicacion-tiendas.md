# Publicación de Stick Live en Google Play y App Store

Copia en el repo del doc del proyecto de Claude `claude/publicacion-tiendas-stick-live.md` (8 de octubre de 2026). La guía paso a paso está en `store/README.md`.

El material de las dos fichas está terminado y en `store/`, con la marca nueva (la i). La app todavía no se puede enviar: no hay ningún build y quedan los bloqueos de abajo.

## Qué hay y dónde

- `store/fichas.md`: textos de ficha en español, inglés, francés, italiano y portugués, con recuento de caracteres.
- `store/google-play/`: metadatos en formato fastlane supply, gráfico destacado por idioma, icono 512, seis capturas 1080×1920 en es-ES, y respuestas de «Seguridad de los datos» y «Contenido de la app».
- `store/app-store/`: `store.config.json` para `eas metadata:push`, icono 1024, capturas de iPhone 6,9" y 6,3", privacidad y clasificación por edad (4+).
- `store/marca/`: SVG maestros de la i, el logotipo, los lockups y las capas del icono.
- App (`apps/mobile`): iconos, splash e icono de notificación en `assets/`; `app.config.ts` con el granate `#9E1235`, iconos oscuro y tintado de iOS y monocromo de Android. Necesita build nuevo.
- Web (`apps/web`): imágenes OG de partido, competición, equipo, jugador y cinco inicial con el lockup de la i (`src/lib/og-brand.tsx`). Imagen social por defecto: `public/og-image-v2.png`.

## Bloqueos antes de enviar

Por orden de riesgo. Los dos primeros harían rechazar la app en las dos tiendas.

1. Comprar Premium en la web desde la app (pago externo de una función digital). Recomendación: esconder la oferta en los builds de tienda.
2. Borrar la cuenta desde la app: falta `DELETE /auth/account`, el botón en Ajustes y la sección en la política. Google Play pide además una URL web de borrado.
3. Política de privacidad: cubrir app, AdMob, Sentry, notificaciones y borrado. Texto en `store/politica-de-privacidad-app.md`.
4. Cabecera y botón de volver: el `Stack` raíz tiene `headerShown: false`.
5. Iniciar sesión con Apple (norma 4.8), solo iOS.
6. Gol: ⚽ en `EventRow.tsx` y `notification-copy.ts`. Propuesta: 🏑, y quitar el prefijo `[Stick Live]` del aviso nativo.
7. AdMob en iOS: falta `iosAppId` y decidir ATT.

## Pendiente de marca fuera de las tiendas

- La interfaz de la app sigue con el granate anterior (`rink-passion`, `#991b1b`, en `tailwind.config.ts` y tres colores sueltos).
- La web mantiene el favicon y los iconos de la PWA con el isotipo anterior.
