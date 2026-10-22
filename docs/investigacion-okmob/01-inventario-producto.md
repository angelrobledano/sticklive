# 01 · Inventario de producto

**Fecha de observación:** 21/10/2026 (UTC)
**Confianza global:** A/B (rutas y artefactos observados; algunas funciones inferidas del bundle)

---

## 1. Posicionamiento

OKMob se presenta como una app **gratuita, sin registro y financiada con publicidad** para seguir el hockey sobre patines «de Cataluña, España y Europa». Su propuesta es una interfaz rápida, móvil y catalana sobre datos que ya publican las federaciones.

Elementos de posicionamiento observados:

- Landing: «L'hoquei patins, minut a minut — resultats en directe».
- «Sense registre» y «gratuïta» en la landing y en los términos.
- Público: aficionados, familias de jugadores de base y cualquier persona que quiera un resultado sin navegar por portales densos.
- Cobertura declarada: FECAPA (desde la Nacional Catalana hasta categorías base), RFEP y World Skate Europe.
- App iOS/Android y PWA instalable.

**No es una app oficial** y no tiene relación ni acuerdo con las federaciones (declarado en la FAQ). Es un visor independiente.

---

## 2. Superficies

| Superficie | Tecnología observada | Función |
|---|---|---|
| Web | Vite + React, SPA, PWA/Workbox | Producto principal; landing estática + rutas de aplicación. |
| App iOS/Android | Shell Capacitor sobre el bundle web | Paridad funcional, push nativo, Live Activities, almacenamiento local. |
| API/CDN | Cloudflare Worker + CDN estática | Catálogo, calendarios, actas, reglas, documentos de directo. |
| Asistente | Clasificador local + fallback cloud | Preguntas en lenguaje natural sobre partidos, reglas, equipos y jugadores. |

---

## 3. Rutas y pantallas

Rutas confirmadas en el bundle (`index-DaXZKQVK.js`) y, en varios casos, abiertas en navegador.

| Ruta | Pantalla | Datos que consume | Indexable | Notas |
|---|---|---|---|---|
| `/` | Landing | HTML estático | Sí | `title`, `description`, JSON-LD y canonical de portada. |
| `/directe` | Directo | `live/board.json`, `live/x/{hash}.json` | Sí | Marcadores en vivo, filtros y seguidos. |
| `/lligues` | Competiciones | `comps`, `arxiu` | Sí | Temporadas 2025/26 y 2026/27. |
| `/c/:idc` | Competición | `calendar.json`, `standings.json`, `stats` | Sí (196 URLs) | Clasificación, calendario, resultados y fases. |
| `/c/:idc/p/:idp` | Partido | `acta.json`, `x`, `day` | No en sitemap | Ficha, cronología, alineaciones, estadísticas y directo. |
| `/e/:team` | Equipo | `comps`, `calendar`, `stats` | Sí (2.752 URLs) | Clave `teamId~competición~nombre`; página por competición. |
| `/club/:club` | Club | `comps.clubs`, equipos | No en sitemap | Agrega las secciones del club. |
| `/j/:idc/:idplayer` | Jugador | `profiles.json`, `person-xwalk` | No en sitemap | Agrega secciones de varias competiciones y temporadas. |
| `/ct/:id` | Entrenador (probable) | `coachSearch`, `coachBadges` | No | Inferido de `CoachScreen`; no se abrió la ruta. |
| `/a/:id` | Árbitro (probable) | `refereeSearch` | No | Inferido de `RefereeScreen`; no se abrió la ruta. |
| `/pv/:venue` | Pabellón | `venuePage`, geolocalización, meteorología | No | Mapa y tiempo del partido; flag `venuePage: true`. |
| `/compara` | Comparador | `h2h`, `stats` | No | Equipos y jugadores. |
| `/compara/e/:teamIdc/:a/:b` | Comparar equipos | `h2h` | No | Dos equipos de la misma competición. |
| `/compara/j/:idcA/:idpA/:idcB/:idpB` | Comparar jugadores | `h2h`, `profiles` | No | Dos jugadores. |
| `/cerca` | Búsqueda | `search` | No (robots) | Equipos, jugadores, entrenadores y árbitros. |
| `/seguint` | Seguidos | Local + push | No (robots) | Equipos seguidos y preferencias. |
| `/ajustos` | Ajustes | Local | No (robots) | Idioma, tema, tamaño de texto, notificaciones, anuncios, IA. |
| `/assistent` | Asistente | `chat`, datos locales | No | Preguntas en catalán/castellano. |
| `/resum` | Resumen | `digest`, seguidos | No | Resumen personal y acceso a la suscripción de calendario. |
| `/reglament` | Reglamento | `rules.json` | No | Reglas, zonas y cascadas por temporada. |
| `/info/:doc` | Información | Documentos | Sí (3 URLs) | `sobre`, `glossari`, `preguntes-frequents`. |
| `/legal/:doc` | Legal | Documentos | Sí (4 URLs) | Privacidad, cookies, condiciones y aviso legal. |
| `/debug` | Debug | Interno | No | Ruta pública en el bundle; no auditada. |
| `/hoquei-patins` | Página SEO | Landing/competition | Sí (1 URL) | Entrada estática del sitemap. |

**Observación:** las URLs de partido, jugador y pabellón **no están en el sitemap**. OKMob indexa competiciones y equipos, no la capa más profunda. Stick Live sí incluye partidos y jugadores en su sitemap por secciones.

---

## 4. Funciones

### 4.1 Directo y resultados

- Marcador en vivo, periodo, reloj, faltas y estado (`live`, `final`, `stale`).
- Cronología de goles, penaltis y faltas directas.
- Alineaciones, dorsales, porteros, goleadores y asistencias.
- Tarjetas de jugador y banquillo (amarilla, azul, roja).
- Tanda de penaltis y resultado final.
- Avisos de gol, inicio, descanso, resultado, tarjeta y penalti (bitmask `reminder/start/half/result/goal/blue/red/penalty` en el bundle).
- Filtros por federación y categoría; preferencias en `localStorage` (`okmob-feds`, `okmob-feds-lists`).

**Límite observado:** en el acta FECAPA `164291`, los eventos se reducen a 4 y los contadores de tarjetas/faltas de jugador están a cero. La cronología no es un espejo completo del acta oficial (ver [06](./06-comparacion-fuentes-oficiales.md)).

### 4.2 Competiciones, equipos y jugadores

- Catálogo de 159 competiciones FECAPA, 37 RFEP y 17 World Skate; temporadas 39 (2025/26) y 41 (2026/27).
- Clasificaciones por grupo, con prioridades y desempates calculados por el cliente a partir de reglas.
- Calendario por jornadas, fases y spans de fechas.
- Archivo de competiciones (`arxiu`) y acceso a temporadas anteriores.
- Ficha de equipo con forma, últimos partidos, plantilla y estadísticas.
- Ficha de club que agrupa equipos.
- Ficha de jugador con secciones por competición/temporada, goles, asistencias, tarjetas y badges.
- Fichas de entrenador y árbitro (inferidas del bundle).
- `person-xwalk`: identidad de jugador entre FECAPA, RFEP y World Skate (1.004 personas; 855 multi-federación).

### 4.3 Comparador y H2H

- `/compara` para equipos y jugadores.
- `h2h` y `PreviousMeeting` en la ficha de partido.
- Comparación de estadísticas, forma y historial.
- No se verificó el flujo completo en navegador; la evidencia es de rutas, chunks y consultas.

### 4.4 Reglamento como datos

- `rules.json` versión 7; 43 reglas en 2025/26 y 23 en 2026/27.
- Campos: `id`, `match`, `phase`, `groups`, `source`, `noteSource`, `zones`, `cascade`, `assumes`.
- Tipos de zona: `campio`, `playoff-ascens`, `descens`, `playout`, `ascens`, `fase-final`, `placement`.
- Cascadas por número de ascensos (`cascade.byN`) y notas con fuente.
- La UI pinta zonas de ascenso/play-off/descenso en la clasificación y explica el escenario.

**Valor:** es una de las funciones más difíciles de replicar y una ventaja clara frente a una tabla plana. Stick Live no tiene hoy un modelo de reglas de competición equivalente.

### 4.5 Previsión

- Motor `engine-D6XHJaii.js`: modelo log-lineal tipo Poisson con ataque, defensa, ventaja de local, `Math.exp`, desviaciones `hypot` y probabilidades. No se observó el ajuste de baja puntuación de Dixon-Coles (no hay `rho`/`tau` en el chunk).
- Priors en `standings.json.priors`: `att`, `def`, `attSd`, `defSd`, `games`, `prevComp`, `season`.
- Escenarios (`predScenario`) y seguimiento de aciertos.
- No se verificó calibración ni metodología publicada; tratarlo como **experimental**.

### 4.6 Asistente

- Clasificador local multinomial tipo Naive Bayes con 30 intents, suavizado de Laplace, bigramas y umbrales `0.97` / `0.9`.
- Respuestas deterministas para preguntas habituales (partidos, clasificación, reglas, jugadores, palmarés).
- Fallback a modelos en Cloudflare Workers AI (la página «Sobre» declara GLM de Z.ai, gpt-oss de OpenAI y Gemma de Google) cuando la consulta es abierta; consentimiento `okmob-ai-consent`.
- Copys de highlights con Llama 3.1 (declarado en «Sobre»).
- Endpoints `/chat`, `/chat/report`, `/chat/credits` en el bundle; no se probaron escrituras.

### 4.7 Pabellón, mapa y meteorología

- Ruta `/pv/:venue` y flag `venuePage: true`.
- Geolocalización de pabellones y enlaces a Google Maps en el calendario `.ics`.
- Meteorología del día del partido vía MET Norway (`api.met.no`), declarada en «Sobre».
- No se verificó la cobertura ni la precisión de los datos de pabellón.

### 4.8 Calendario suscribible

- `GET https://push.okmob.app/team.ics?id={teamId~competición~nombre}`.
- `text/calendar`, `Europe/Madrid`, `REFRESH-INTERVAL:PT6H`, `X-WR-CALNAME`, `GEO`, `LOCATION`, `URL`.
- Ejemplo verificado: 60 eventos para `BARÇA · Nacional Catalana`, 44.378 bytes, caché 1 h.
- **No incluye `VALARM`**: no hay recordatorios automáticos dentro del `.ics`.
- Es una función de retención de bajo coste que Stick Live no tiene.

### 4.9 Búsqueda y seguidos

- Búsqueda global de equipos, jugadores, entrenadores y árbitros (`playerSearch`, `coachSearch`, `refereeSearch`).
- La FAQ declara que la búsqueda de equipos se limita a la temporada actual y a equipos con partidos programados.
- Seguidos y preferencias se guardan en local; no hay cuenta ni sincronización entre dispositivos.
- Push nativo por equipo/tema; el web no envía push con la pestaña cerrada (declarado en FAQ).

### 4.10 Offline, PWA y app

- Service worker/Workbox, caché de chunks y datos, `okmob-cache-v1`, `okmob-chunk-reload`, `okmob-boot-stuck`.
- IndexedDB `keyval-store` y `okmob-crests-v1`; escudos y datos persistidos.
- Instalación PWA y enlaces a App Store/Google Play.
- Live Activities y Dynamic Island en iOS (notas de la versión 1.5.21 y claves `okmob-la-*`).
- Widgets/notificaciones nativas en Android (inferido del bundle y del manifiesto Capacitor).

### 4.11 Ajustes y accesibilidad

- Idioma, tema (auto/claro/oscuro), tamaño de texto (auto hasta 130 %), notificaciones, consentimiento de anuncios y de IA.
- Viewport sin `maximum-scale` y comentario explícito para no bloquear el zoom; inputs a 16 px para evitar el zoom automático de iOS.
- Safe areas, `viewport-fit=cover`, barra de navegación inferior.
- Manejo de errores por categorías: `device-offline`, `upstream-sidgad`, `own-backend`, `stale-data`.
- Pull-to-refresh, skeletons, reintentos y mensajes de estado.

---

## 5. Idioma

- Web: `lang="ca"`; JSON-LD `inLanguage: ["ca", "es"]`; textos principales en catalán.
- App Store: «ES y 2 más»; la app declara catalán, castellano e inglés.
- Ajustes: selector de idioma.
- El portal y las actas usan catalán/castellano de forma mezclada (`period: "FINALIZAT"`, `clockPeriod: "P10"`, nombres de equipos en mayúsculas).

**Contraste con Stick Live:** la web y la app de Stick Live soportan 5 idiomas (`es`, `en`, `pt`, `fr`, `it`) pero **no catalán**. Para el mercado de FECAPA, esto es una brecha directa frente a OKMob.

---

## 6. SEO

| Elemento | Observación | Confianza |
|---|---|---|
| Sitemap | 2.958 URLs: 1 portada, 1 `/lligues`, 1 `/hoquei-patins`, 3 `/info`, 4 `/legal`, 196 `/c/`, 2.752 `/e/`. Sin partidos, jugadores ni pabellones. | A |
| `lastmod` | Las 2.958 entradas comparten `lastmod` = 2026-10-21. No parece derivado de la fecha real de cada entidad. | A |
| `changefreq` / `priority` | 2.948 entradas `weekly` / `0.5`; 9 `monthly` / `0.6`; 1 `daily` / `1.0`. Google ignora estos campos. | A |
| Robots | `Disallow: /seguint`, `/cerca`, `/ajustos`; sitemap declarado. | A |
| Render | Las rutas `/c/4858`, `/e/...` y `/lligues` devuelven el mismo HTML de 12.535 bytes, con `<title>` y `canonical` de la landing. El contenido se hidrata en cliente. | A |
| Metadatos | Landing con `title`, `description`, Open Graph, canonical y JSON-LD `WebSite` + `WebApplication` + `Person`. | A |
| Idiomas | JSON-LD `ca`/`es`; sin `hreflang` por idioma en el HTML profundo. | A |

**Lectura:** OKMob tiene una landing bien maquetada y un sitemap amplio, pero su capa profunda es CSR con canonical de portada. Es una base SEO más frágil que la de Stick Live (Next.js SSR, sitemap por secciones, `lastmod` de datos, `hreflang` por locale). No conviene copiar este enfoque.

---

## 7. Monetización

- **Anuncios**: AdSense en web y AdMob en la app (FAQ).
- **Sin registro, sin suscripciones y sin compras** según los términos (2026-10-10).
- **Sin paywall**: ninguna función queda restringida por no aceptar publicidad personalizada (`noBypassOnDecline`).
- **Flag `assistantAds: true`**: el asistente puede mostrar anuncios.
- La ficha pública de App Store indica `hasInAppPurchases: false` e `isFree: true`; «Sobre» declara que no hay suscripciones ni compras. No se observó una capa de pago.

**Contraste con Stick Live:** Stick Live tiene Stripe/premium y configuración remota de anuncios; no debe renunciar a ese modelo para imitar el «gratis con anuncios» de OKMob.

---

## 8. UX y calidad percibida

Fortalezas observadas:

- Prioridad móvil: navegación inferior, tarjetas, gestos, safe areas.
- Arranque rápido: landing estática, bundle dividido por rutas, caché de chunks.
- Transparencia de estado: `stale`, `at`, `observedAt`, mensajes de error por categoría.
- Accesibilidad básica: zoom permitido, texto escalable, contraste y modo oscuro.
- Continuidad offline: datos persistidos y escudos en IndexedDB.
- Notificaciones y Live Activities como canal fuera de la app.

Debilidades o riesgos:

- CSR profundo y canonical de portada (SEO).
- Cronología de actas incompleta en la muestra.
- Búsqueda limitada a la temporada actual (declarado).
- Sin cuenta: seguidos y preferencias no se sincronizan.
- Sin push web con la pestaña cerrada (declarado).
- Dependencia total de Sidgad: un cambio de HTML puede romper la ingesta.
- `config.json` y `/debug` públicos; no se auditó su superficie de escritura.

---

## 9. Evidencias principales

| Evidencia | URL / artefacto | Fecha | Confianza |
|---|---|---|---|
| Landing y metadatos | `https://okmob.app/` | 21/10/2026 | A |
| Sitemap y robots | `https://okmob.app/sitemap.xml`, `/robots.txt` | 21/10/2026 | A |
| Rutas | Bundle `index-DaXZKQVK.js` | 21/10/2026 | A |
| Catálogo | `https://push.okmob.app/comps` | 21/10/2026 16:04 UTC | A |
| Reglamento | `https://push.okmob.app/rules.json?v=7` | 21/10/2026 16:04 UTC | A |
| Calendario `.ics` | `https://push.okmob.app/team.ics?id=234~Nacional%20Catalana~BAR%C3%87A` | 21/10/2026 16:20 UTC | A |
| Crosswalk de personas | `https://live.okmob.app/ref/person-xwalk.json` | 21/10/2026 12:15 UTC | A |
| Términos, «Sobre», FAQ | `https://okmob.app/legal/condicions`, `/info/sobre`, `/info/preguntes-frequents` | 21/10/2026 | A |
| Fichas de tienda | App Store y Google Play | 21/10/2026 | A |

---

## 10. Incógnitas

- ¿La app móvil usa exactamente el mismo bundle y los mismos endpoints que la web? La evidencia (Capacitor, claves `okmob-la-*`, `/sync`) lo sugiere, pero no se capturó tráfico.
- ¿Qué hay detrás de `/debug` y `/sync`? No se probaron escrituras.
- ¿Cómo se genera el `person-xwalk`? ¿Algoritmo, revisión manual o ambos? No hay documentación pública.
- ¿La previsión tiene calibración publicada? No se encontró.
- ¿La cobertura FISR es estable o experimental? El flag `fedFisr` está activo, pero los términos no la mencionan.
- ¿El `lastmod` uniforme del sitemap es intencional o un bug de generación? No se puede saber desde fuera.
