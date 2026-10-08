# Google Play · Seguridad de los datos

Respuestas para el formulario de Play Console (Contenido de la app → Seguridad de los datos), sacadas del código de `apps/mobile` y de los SDK que lleva: PostHog, Sentry, Expo Notifications y Google Mobile Ads (AdMob). Si cambia lo que recoge la app, hay que volver a rellenarlo.

## Preguntas generales

| Pregunta | Respuesta |
|---|---|
| ¿Tu app recoge o comparte alguno de los tipos de datos de usuario obligatorios? | Sí |
| ¿Todos los datos se cifran en tránsito? | Sí (todo va por HTTPS) |
| ¿Ofreces a los usuarios una forma de solicitar que se eliminen sus datos? | Sí |
| ¿La app permite crear una cuenta? | Sí, con Google |
| URL para solicitar la eliminación de la cuenta | La de la sección «Borrar tu cuenta» de la política de privacidad (ver `../politica-de-privacidad-app.md`). Hasta que exista, Play no acepta el formulario |

## Tipos de datos

En la columna «Compartido» solo cuenta lo que llega a terceros que no trabajan por encargo de Stick Live. PostHog, Sentry y Expo procesan por encargo, así que no cuentan como compartido. AdMob es Google actuando como red publicitaria: lo que recoge su SDK sí se declara como compartido.

| Categoría → tipo | Recogido | Compartido | Obligatorio u opcional | Para qué |
|---|---|---|---|---|
| Información personal → Dirección de correo electrónico | Sí | No | Opcional (solo si inicias sesión) | Gestión de la cuenta, Funcionalidad de la app (sincronizar favoritos), Analíticas (se vincula a PostHog tras el login) |
| Información personal → ID de usuario | Sí | No | Opcional | Gestión de la cuenta, Funcionalidad de la app |
| Actividad en la app → Interacciones con la app | Sí | Sí (AdMob) | Obligatorio | Analíticas (eventos de PostHog: partido abierto, favoritos, avisos), Publicidad o marketing (AdMob) |
| Actividad en la app → Otras acciones | Sí | No | Opcional | Funcionalidad de la app (equipos, ligas y jugadores que sigues y sus avisos) |
| Información y rendimiento de la app → Registros de fallos | Sí | Sí (AdMob) | Obligatorio | Analíticas, Funcionalidad de la app (Sentry) |
| Información y rendimiento de la app → Diagnósticos | Sí | Sí (AdMob) | Obligatorio | Analíticas (Sentry muestrea el 10 % de las trazas) |
| Dispositivo u otros identificadores | Sí | Sí (AdMob) | Obligatorio | Funcionalidad de la app (identificador del dispositivo y token de notificaciones), Analíticas, Publicidad o marketing y Prevención de fraude (ID de publicidad de AdMob) |
| Ubicación → Ubicación aproximada | Sí | Sí (AdMob) | Obligatorio | Publicidad o marketing, Analíticas (AdMob la deduce de la IP) |

No se recoge nada de estos grupos: ubicación precisa, mensajes, fotos y vídeos, audio, archivos, calendario, contactos, información financiera, salud, navegación web ni apps instaladas.

Las búsquedas se mandan al servidor solo para responderlas y no se guardan, así que no se declaran.

## Antes de enviarlo

- Comprueba la parte de AdMob en la guía oficial de Google para este formulario: [Preparar la sección de seguridad de los datos (Google Mobile Ads SDK)](https://developers.google.com/admob/android/privacy/play-data-disclosure). Si Google ha cambiado algún tipo de dato, manda su versión.
- La app tiene que mostrar el aviso de consentimiento de Google (UMP) antes de pedir anuncios en el EEE. La pantalla «Publicidad y privacidad» ya existe en Ajustes. Antes de publicar, prueba en un dispositivo que el aviso sale la primera vez.
