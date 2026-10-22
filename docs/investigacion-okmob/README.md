# Auditoría técnica de OKMob

**Fecha de observación:** 21/10/2026 (UTC)
**Ámbito:** producto web, API pública, app móvil (evidencia pública), fuentes oficiales, arquitectura de datos y directo.
**Autor:** equipo de ingeniería de Stick Live.
**Estado:** auditoría de solo lectura. Sin acceso autenticado, sin pruebas de carga, sin scraping masivo y sin reutilización de contenido.

---

## Resumen ejecutivo

1. **OKMob no es una API REST ni una aplicación oficial.** Es un visor independiente, gratuito y financiado con publicidad, construido sobre los mismos portales **Sidgad** que ya usa Stick Live. Su valor está en la cobertura, la interfaz y el procesamiento, no en una fuente de datos exclusiva.
2. **Cobertura observada:** 159 competiciones de FECAPA (110 vigentes), 37 de RFEP (28 vigentes), 17 de World Skate (17 vigentes) y partidos de FISR (Italia) en el bundle de directo. Los términos y la página «Sobre» solo declaran FECAPA, RFEP y World Skate Europe: **FISR no aparece en la declaración de fuentes**.
3. **Arquitectura:** SPA Vite + PWA/Workbox y app Capacitor; un worker en Cloudflare (`push.okmob.app`) que scrapea y normaliza; y una CDN estática con documentos direccionados por contenido (`live.okmob.app`). No hay una base de datos pública ni un API REST clásico.
4. **Directo:** manifiesto `board.json` con caché de 10 s; índice de documentos calientes `live/docs/{hash}.json`; bundle `live/x/{hash}.json`; snapshots inmutables de actas, días y tickers. El cliente sondea cada **15 s** si hay un partido en juego o un acta sin cerrar; en reposo, hasta **120 s**. Se pausa con la pestaña oculta.
5. **Fidelidad de datos:** en el acta FECAPA `idp=164291` (Calafell 0–1 Barça, 18/10/2026) coinciden marcador, pabellón, árbitros, goleador, faltas directas, faltas de equipo (12/10) y amarillas de banquillo. Pero OKMob expone **4 eventos** frente a una retahíla de expulsiones de 2 minutos, tiempos muertos y acciones del acta oficial; los contadores `yellow/blue/red` y `fouls` de todos los jugadores están a cero. El `clockPeriod: "P10"` **no es un bug**: el acta oficial también muestra `P10 00:00`.
6. **RFEP:** los 7 resultados de la Jornada 4 de `R3575` coinciden exactamente con el portal oficial. Es una muestra agregada, no acta a acta.
7. **Identidad:** OKMob usa `fx = {idc}|{iso}|{homeTeamId}|{awayTeamId}` y versiones `av` para direccionar actas inmutables. Los prefijos de federación son implícitos (`R` RFEP, `W` World Skate, `I` FISR; FECAPA numérico): **`calendar.json?idc=260` devuelve datos de FECAPA 2021, mientras `idc=W260` devuelve la Champions League**. Además, OKMob ya tiene un crosswalk de personas (`ref/person-xwalk.json`): **1.004 personas, 855 (85,2 %) presentes en más de una federación** y 108 en FECAPA + RFEP + World Skate.
8. **Producto:** más de 20 rutas (directo, ligas, competición, partido, equipo, club, jugador, pabellón, comparador, búsqueda, seguidos, ajustes, asistente, resumen, reglamento, información y legal). Reglamento como datos con zonas y cascadas, previsión tipo Poisson, asistente local con Naive Bayes y fallback a modelos en Cloudflare, comparador, meteorología y suscripción de calendario.
9. **SEO:** el sitemap declara 2.958 URLs (196 competiciones, 2.752 equipos), pero las rutas profundas devuelven el mismo HTML de la landing (12.535 bytes) con el `title` y el `canonical` de la portada; el contenido se renderiza en cliente. Es CSR con fallback, no SSR/SSG. Stick Live, con Next.js SSR y sitemap por entidades, tiene una base técnica superior.
10. **Móvil:** iOS 1.5.22 (29 valoraciones, 5,0; 37,6 MB), Android 1.5.21, 1K+ instalaciones y actualización del 18/10/2026; shell Capacitor, FCM/APNs, Live Activities/Dynamic Island y almacenamiento local. La app de Stick Live (Expo) tiene paridad funcional en código, pero la distribución en tiendas y las Live Activities siguen siendo una asignatura pendiente.

### Lectura estratégica

La ventaja de OKMob **no es el dato**: ambos productos leen Sidgad. Su ventaja es haber convertido ese dato en una experiencia rápida, catalana y móvil, y haber añadido capas que Stick Live aún no opera: cobertura FECAPA, reglamento como datos, identidad de jugador entre federaciones, comparador, Live Activities y asistente.

Stick Live puede cerrar la brecha de datos con palancas que ya tiene a medio construir: activar FECAPA, añadir catalán, completar la fidelidad de actas, crear el crosswalk de jugadores y publicar la app. No debería copiar el modelo de CDN estática, el CSR, el modelo ads-only ni el alcance del asistente/previsión sin evidencia de necesidad.

---

## Método y límites

### Qué se hizo

- Peticiones HTTP públicas y de bajo volumen a `okmob.app`, `push.okmob.app` y `live.okmob.app` (landing, robots, sitemap, configuración, catálogo, calendarios, clasificaciones, actas, reglamento, perfiles, tickers y documentos de directo).
- Inspección del bundle JavaScript público (rutas, claves de almacenamiento, clasificador del asistente, motor de previsión, endpoints y política de red).
- Navegación con navegador de escritorio a los portales oficiales de FECAPA, RFEP y World Skate Europe para comparar una muestra pequeña y razonada.
- Lectura del repositorio de Stick Live para contrastar arquitectura, cobertura, i18n, SEO, app móvil, caché y modelo de datos.

### Qué no se hizo

- No se accedió a sistemas privados, paneles de administración, cookies de terceros ni credenciales.
- No se evadió CAPTCHA, autenticación ni limitación de tasa.
- No se hicieron pruebas de carga, estrés, denegación de servicio ni scraping masivo.
- No se capturó tráfico real de la app móvil (no hay dispositivo/emulador en el entorno).
- No se obtuvo una comparación profunda de actas de World Skate (el portal no abrió la competición y el acta directa quedó bloqueada por sesión).
- No se midió latencia de extremo a extremo ni se comparó con una fuente de referencia en vivo.
- No se verificó el estado de producción de Stick Live (activación de FECAPA, release de la app).

### Muestra

| Muestra | Qué se comparó | Profundidad |
|---|---|---|
| FECAPA `idp=164291`, `idc=4858` | Acta oficial vs acta OKMob | Alta (marcador, árbitros, eventos, faltas, banquillo) |
| RFEP `R3575`, Jornada 4 | 7 resultados oficiales vs calendario OKMob | Media (agregada) |
| World Skate `W260` | Calendario OKMob vs portal oficial | Baja (portal no abrió la competición) |
| FISR `I1898` | Partido en vivo en el bundle `x` | Baja (sin comparación oficial) |

---

## Nivel de confianza

| Nivel | Significado |
|---|---|
| **A — Observado** | Dato leído directamente en una respuesta HTTP, en el DOM, en el bundle o en el repositorio. |
| **B — Inferido** | Conclusión razonable a partir de varios artefactos, sin documentación del operador. |
| **C — Declarado** | Afirmación del operador (términos, «Sobre», FAQ, ficha de tienda), no verificada de forma independiente. |
| **D — Desconocido** | No se pudo verificar; se indica explícitamente. |

Cada conclusión relevante lleva su nivel y su fecha de observación. Las inferencias no se presentan como hechos.

---

## Índice

| Documento | Contenido |
|---|---|
| [01-inventario-producto.md](./01-inventario-producto.md) | Páginas, funciones, UX, i18n, SEO, monetización y superficies de producto. |
| [02-fuentes-e-ingesta.md](./02-fuentes-e-ingesta.md) | Fuentes declaradas vs observadas, Sidgad, espacios de IDs, ingesta, normalización y tasa. |
| [03-api-y-arquitectura-directo.md](./03-api-y-arquitectura-directo.md) | Inventario de endpoints, esquemas, protocolo de directo, caché, rendimiento y fiabilidad. |
| [04-modelo-dominio.md](./04-modelo-dominio.md) | Modelo de entidades inferido, identidad (`fx`, `av`, prefijos), reglamento, previsión y asistente. |
| [05-app-movil.md](./05-app-movil.md) | Shell Capacitor, push, Live Activities, offline, tiendas y límites de la evidencia. |
| [06-comparacion-fuentes-oficiales.md](./06-comparacion-fuentes-oficiales.md) | Comparación FECAPA, RFEP y World Skate; discrepancias y causas. |
| [07-analisis-competitivo-stick-live.md](./07-analisis-competitivo-stick-live.md) | Matriz de capacidades, fortalezas/debilidades y qué no copiar. |
| [08-recomendaciones.md](./08-recomendaciones.md) | Roadmap priorizado con esfuerzo, riesgo, métricas y verificación. |
| [09-evidencias-y-confianza.md](./09-evidencias-y-confianza.md) | Registro de evidencias, incógnitas, redacciones y notas de reproducción. |

---

## Redacciones y privacidad

En este informe se han redactado o omitido:

- El correo electrónico de contacto del operador que aparece en el JSON-LD público.
- La fecha de nacimiento de los jugadores en las fichas.
- Identificadores de Firebase, AdSense/AdMob, claves de API y cualquier token o cookie.
- Datos personales no necesarios para explicar el producto.

Los nombres de jugadores, árbitros y entrenadores que aparecen en las actas son datos deportivos públicos; se usan solo como evidencia de la comparación y no se listan de forma exhaustiva.

---

## Conclusión en una frase

**OKMob es un competidor serio en experiencia y cobertura, construido sobre la misma materia prima que Stick Live; la respuesta correcta no es copiar su arquitectura, sino igualar su cobertura y su identidad de datos, y ganar en fiabilidad, SEO, operación y confianza.**
