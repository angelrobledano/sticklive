# Google Play · Contenido de la app y ficha

Respuestas para las secciones de Play Console que no son la ficha de Play Store. El orden es el mismo que el de Play Console.

## Contenido de la app

| Sección | Respuesta |
|---|---|
| Política de privacidad | `https://sticklive.eu/es/privacy`. Antes, añade lo de la app (ver `../politica-de-privacidad-app.md`) |
| Acceso a la app | «Todas las funciones están disponibles sin restricciones de acceso». El inicio de sesión es opcional y vale cualquier cuenta de Google |
| Anuncios | Sí, la app contiene anuncios |
| Clasificación de contenido (IARC) | Categoría: «Referencia, noticias o educación». No a violencia, sexo, lenguaje, drogas, apuestas, interacción entre usuarios, compartir ubicación y compras digitales dentro de la app. Resultado esperado: PEGI 3 y «Todos» |
| Público objetivo | 18 años o más (puedes añadir 16-17). No marques menores de 13: activaría la política de Familias y AdMob tendría que servir solo anuncios aptos para niños |
| App de noticias | No |
| Apps de salud | No |
| Apps gubernamentales | No |
| Funciones financieras | Ninguna |
| ID de publicidad | Sí, la app lo usa para publicidad y analíticas (lo pide el SDK de AdMob y añade el permiso `AD_ID`) |
| Seguridad de los datos | Ver `seguridad-de-datos.md` |

## Ficha de Play Store

| Campo | Fichero |
|---|---|
| Nombre de la app, descripción breve, descripción completa | `metadata/<idioma>/title.txt`, `short_description.txt`, `full_description.txt` |
| Icono 512×512 | `metadata/es-ES/images/icon.png` |
| Gráfico destacado 1024×500 | `metadata/<idioma>/images/featureGraphic.png` (uno por idioma) |
| Capturas de teléfono 1080×1920 | `metadata/es-ES/images/phoneScreenshots/` (6, en orden) |
| Notas de la versión | `metadata/<idioma>/changelogs/default.txt` |
| Categoría | Deportes |
| Etiquetas | Deportes, Resultados deportivos (elige las que ofrezca Play Console) |
| Correo de contacto | robledano@gmail.com |
| Sitio web | https://sticklive.eu |

La estructura de `metadata/` es la de `fastlane supply`. Si algún día usas fastlane, sube todo con `fastlane supply --metadata_path store/google-play/metadata`. Si no, copia y pega en Play Console.

Las capturas de otros idiomas no son obligatorias: Play enseña las de `es-ES` (idioma por defecto) en el resto de fichas.

## Producción si tu cuenta es personal

Las cuentas personales de desarrollador creadas después del 13 de noviembre de 2023 no pueden publicar en producción hasta hacer una prueba cerrada con al menos 12 testers que sigan apuntados 14 días seguidos. Después hay que pedir el acceso a producción respondiendo un cuestionario. Para no repetir trabajo:

1. Prueba interna (la pista `internal` de `eas.json`) para validar login, favoritos y avisos en tu móvil.
2. Prueba cerrada con 12 testers o más. Avisa a gente de los clubes y de tu entorno: necesitas que la instalen y la abran durante esos 14 días.
3. Pide producción con lo que haya salido de la prueba: qué cambiaste y por qué crees que está lista.
