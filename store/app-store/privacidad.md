# App Store · Privacidad de la app

Respuestas para App Store Connect (Privacidad de la app). Valen para la versión de iOS cuando lleve los mismos SDK que la de Android: PostHog, Sentry, Expo Notifications y Google Mobile Ads.

Hay una decisión por tomar antes: si en iOS se piden permisos de rastreo (App Tracking Transparency) para mostrar anuncios personalizados. Abajo está la versión con ATT, que es la que da más ingresos. Sin ATT, los anuncios no son personalizados y desaparece la sección de rastreo.

## Datos recopilados

| Tipo de dato | Vinculado a la identidad | Usado para rastrear | Finalidades |
|---|---|---|---|
| Información de contacto → Correo electrónico | Sí | No | Funcionalidad de la app, Analíticas |
| Identificadores → ID de usuario | Sí | No | Funcionalidad de la app, Analíticas |
| Identificadores → ID del dispositivo | Sí | Sí, si el usuario acepta ATT | Funcionalidad de la app (avisos), Analíticas, Publicidad de terceros |
| Contenido del usuario → Otro contenido del usuario (equipos, ligas y jugadores que sigues) | Sí | No | Funcionalidad de la app |
| Datos de uso → Interacción con el producto | Sí | Sí, si el usuario acepta ATT | Analíticas, Publicidad de terceros |
| Datos de uso → Datos publicitarios | No | Sí, si el usuario acepta ATT | Publicidad de terceros |
| Diagnóstico → Datos de fallos | No | No | Funcionalidad de la app, Analíticas |
| Diagnóstico → Datos de rendimiento | No | No | Analíticas |
| Diagnóstico → Otros datos de diagnóstico | No | No | Analíticas |
| Ubicación → Ubicación aproximada | No | Sí, si el usuario acepta ATT | Publicidad de terceros, Analíticas |

## Qué hay que añadir a la app para iOS

- `iosAppId` de AdMob en `app.config.ts`. Hoy el plugin solo avisa, y un build de iOS sin él se cerraría al arrancar.
- Si se usa ATT: `NSUserTrackingUsageDescription` en `ios.infoPlist` y pedir el permiso antes de cargar anuncios personalizados. Un texto posible: «Stick Live usa este permiso para mostrarte anuncios más relevantes. La app funciona igual si no lo das.»
- La URL de opciones de privacidad (`privacyChoicesUrl`) puede apuntar a la política de privacidad hasta que haya una página propia.
