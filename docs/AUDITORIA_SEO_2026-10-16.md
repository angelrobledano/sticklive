# Auditoría SEO y calidad de datos — diagnóstico y plan

**Fecha:** 16/10/2026 · **Alcance:** web pública `sticklive.eu` (Next.js, `apps/web`), API pública que la alimenta (`apps/api`, servida en `/api/*`), esquema y ETL en lo que afecta a lo que se publica e indexa.
**Método:** lectura del código en `main` (commit `263d445`, contrastado con `267c165`, que no toca SEO), rastreo real de producción el 16/10/2026 entre las 17:15 y las 18:10 (hora de Madrid) con user-agent de Googlebot, volcado completo del sitemap, descarga de la API pública para las 3.001 entidades del sitemap y Lighthouse de laboratorio en cuatro páginas.
**Actualización (16/10/2026, 20:00):** consultado Search Console (propiedad de dominio `sticklive.eu`) en modo solo lectura. Los datos reales están en §1b y han cambiado la prioridad del plan: el problema número uno ya no es el volumen indexable sino que **Google no ve el canonical** de las fichas (SEO-02).
**Limitaciones:** sin acceso a la base de datos de producción. Las métricas de rendimiento son de laboratorio (Lighthouse móvil simulado): Search Console no tiene datos de Core Web Vitals por falta de tráfico.
**Esta fase no cambia código ni datos.** Todo lo que aparece como "solución" es una propuesta pendiente de aprobación.

Convención de cada hallazgo: severidad (Crítica, Alta, Media, Baja) y confianza (Alta = verificado en producción o en el código, Media = evidencia parcial, Baja = hipótesis que hay que validar).

---

## 1. Resumen ejecutivo

La base técnica está mejor que la media de un proyecto de este tamaño: SSR real en todas las fichas, 404 correctos para entidades inexistentes, canonical y hreflang declarados en cada página indexable, sitemap índice segmentado, robots coherente, JSON-LD escapado contra XSS y una regla de calidad (`data_quality`) que ya filtra el sitemap.

**Pero Search Console demuestra que hay dos fallos técnicos que sí están rompiendo la indexación** (§1b). Cuando una ficha se sirve sin caché, Next emite el `<title>`, el canonical y el hreflang fuera del `<head>`, Google los ignora ("canónica declarada por el usuario: ninguna") y elige como canónica la URL sin idioma, que es una redirección temporal. Resultado: el 32 % de la muestra de páginas indexadas son URLs sin idioma que redirigen, las versiones `/en` salen como "duplicadas sin canónica" y `/es` es solo el 9 % de lo indexado aunque España da el 61 % de las impresiones. Y el 51 % de todas las peticiones de Googlebot en 90 días son redirecciones temporales provocadas por los enlaces internos sin idioma.

Después de eso, el problema es de **qué se publica como indexable**. De las 15.115 URLs del sitemap, el 55 % (8.335) son fichas de jugador de unas 85 palabras, el 85 % de las fichas de partido son partidos que aún no se han jugado (457 de ellos a más de 90 días vista) y 62 de los 346 equipos no tienen ni partidos ni plantilla. Todo ello multiplicado por cinco idiomas cuyo contenido principal es el mismo (similitud del 96 % entre `/es` y `/it` en una ficha de competición). Para un dominio de cuatro meses, sin autoridad, eso es exactamente el patrón que Google trata como contenido escalado de poco valor y que lleva a "Rastreada, actualmente sin indexar" a escala, arrastrando también a las páginas buenas (competiciones y partidos con acta).

Riesgos principales, por orden:

0. **Google no ve el canonical ni el hreflang de las fichas** y canoniza sobre URLs sin idioma que redirigen. Verificado en Search Console y reproducido en producción (12 de 12 fichas en frío con la metadata fuera del `<head>`). Severidad crítica, confianza alta. Es lo primero que hay que arreglar y es un cambio pequeño.
1. **Volumen indexable desproporcionado frente al contenido real** (jugadores, equipos vacíos, partidos lejanos, 5 idiomas). Riesgo de calidad algorítmica a nivel de sitio. Severidad alta, confianza media. Search Console matiza el diagnóstico: Google solo conoce unas 2.650 de las 15.115 URLs del sitemap y "Rastreada, actualmente sin indexar" afecta a 247, sobre todo partidos y jugadores. El cuello de botella hoy es de descubrimiento y canonicalización, el de calidad llegará en cuanto se arregle lo primero.
2. **Fichas de jugadores menores de edad indexadas con nombre completo y foto**: 82 jugadores con el Mundial Sub-19 en su historial y ninguno con fecha de nacimiento para saber quién es menor. Es un riesgo legal antes que SEO. Severidad crítica, confianza alta en el hecho, la valoración legal no me corresponde.
3. **Los enlaces internos no llevan idioma** y pasan por una redirección 307 que a Googlebot siempre le manda a `/en`. Los idiomas `es`, `pt`, `fr` e `it` solo se descubren por sitemap y hreflang. Search Console: el 51 % de las 31.500 peticiones de rastreo de 90 días son redirecciones temporales. Severidad alta, confianza alta.
4. **Las bajas y fusiones de entidades no dejan rastro**: fusionar equipos, separar filiales o re-crear una competición desde cero produce 404 sin redirección, y el `lastmod` del sitemap se reescribe en cada pasada del ETL (4.865 de 4.940 URLs de partido con el mismo `lastmod`, el de la última hora). Search Console: la segunda página con más clics del sitio (`/en/matches/d87e7dfc-…`, 9 clics) es hoy un 404, igual que otras 8 URLs de partido con impresiones. Severidad alta, confianza alta.
5. **Títulos y nombres poco fiables**: nombres de la fuente en mayúsculas, normalizaciones erróneas ("C.e. Noia Freixenet"), nombres de jugador con el orden roto ("Luis Cortes García José"), selecciones nacionales con el mismo título para cinco equipos distintos ("Italia") y partidos de ida y vuelta o de distintas competiciones con títulos idénticos (77 partidos). Severidad media, confianza alta.

Recomendación, en una frase: **primero reducir y sanear lo que se declara indexable y arreglar los enlaces internos, después mejorar titles, OG y datos estructurados, y dejar quieta la estructura de URLs.** Antes que todo eso, servir la metadata en el `<head>` (F1-0). El detalle de qué tocar y qué no está en §18.

---

## 1b. Lo que dice Search Console (consultado el 16/10/2026)

Periodo disponible: 10/06/2026 a 14/10/2026. Prácticamente todo el tráfico se concentra desde finales de septiembre (Mundial de los WSG Asunción 2026).

**Rendimiento.** 59 clics, 636 impresiones, CTR 9,3 %, posición media 8,9. Por país: España 42 clics y 390 impresiones, Portugal 9 y 40, Francia 1 y 29, Italia 1 y 9, Argentina 0 y 20, India 0 y 16, Chile 0 y 16. Por dispositivo: móvil 42 y 465, ordenador 17 y 158. Core Web Vitals: sin datos (tráfico insuficiente).

**Consultas visibles (31).** La que más: "resultados mundial hockey patines masculino 2026" (3 clics, 21 impresiones). Marca: "sticklive" en posición 7 y "stick live" en 3,8, sin clics. Hay demanda por nombre de jugador ("joel mila", "florencia felamini", "eloi cervera", "blai roca", "marc rouze", "fernando barea", "poletti"), por partido de selecciones ("chile vs angola", "austria vs india", "suiza - portugal") y por liga ("ok plata sur", "ok liga plata", "ok liga plata femenina").

**Páginas con impresiones (163 URLs).**

| Agrupación | URLs | Clics | Impresiones |
|---|---:|---:|---:|
| Competiciones | 33 | 41 | 390 |
| Partidos | 41 | 13 | 97 |
| Jugadores | 64 | 6 | 108 |
| Equipos | 21 | 1 | 25 |
| Home | 3 | 0 | 26 |
| Idioma `es` | 28 | 35 | 359 |
| Idioma `en` | 48 | 12 | 104 |
| `pt` / `fr` / `it` | 18 | 5 | 38 |
| **Sin idioma (URL que redirige con 307)** | **69** | **9** | **146** |
| Host `www` | 18 | 2 | 56 |

La página con más clics (31 de 59) es `/es/competitions/0ffb4a72-…`, una URL antigua por id de temporada (Mundial Masculino), que hoy redirige con 308 a la competición. 9 URLs con impresiones devuelven ahora 404, todas de partido, entre ellas la segunda página del sitio (`/en/matches/d87e7dfc-…`, 9 clics).

**Indexación.** 2.084 indexadas y 570 no indexadas. Google conoce unas 2.650 URLs frente a las 15.115 del sitemap.

| Motivo de no indexación | Páginas | Qué hay dentro |
|---|---:|---|
| Rastreada: actualmente sin indexar | 247 | 110 partidos, 83 jugadores, 25 equipos, 23 imágenes OG/Twitter, 4 competiciones. 72 sin idioma, 91 en `en` |
| Página alternativa con etiqueta canónica adecuada | 189 | 186 son `www.sticklive.eu/en/…` (rastreadas cuando `www` servía contenido). Correcto |
| Página con redirección | 92 | Todas sin idioma (24 en `www`). Esperado |
| Duplicada: el usuario no ha indicado ninguna versión canónica | 32 | **Todas en `/en/…`**, entre ellas competiciones con tráfico. Validación iniciada por alguien |
| No se ha encontrado (404) | 5 | |
| Excluida por `noindex` | 4 | |
| Duplicada: Google ha elegido otra canónica | 1 | |

Muestra de 1.000 indexadas (el máximo que da la herramienta): 322 sin idioma (32 %), 88 en `www` (9 %), `en` 374, `es` 94, `pt` 85, `fr` 72, `it` 53. Por tipo: partidos 521, jugadores 227, equipos 218, competiciones 31.

**Inspección de URL.**
- `/es/competitions/0ffb4a72-…`: indexada, último rastreo 9/10, **canónica declarada por el usuario: ninguna**. El HTML rastreado que guarda Google cierra el `<head>` sin `<title>` ni `<link rel="canonical">`.
- `/en/competitions/0ffb4a72-…`: no indexada, "Duplicada sin canónica", canónica declarada ninguna, **canónica elegida por Google: `https://sticklive.eu/competitions/0ffb4a72-…`** (la URL sin idioma que redirige con 307).

**Sitemaps.** `/sitemap-index.xml` enviado y leído el 16/10, correcto, aún sin páginas descubiertas. Sigue dado de alta `/sitemap.xml` (11/06), que devuelve 404 y figura como "No se ha podido obtener".

**Estadísticas de rastreo (90 días).** 31.500 peticiones, tiempo medio de respuesta 217 ms. Por respuesta: redirección temporal 51 %, 200 49 %, 404, 5xx, 301 y 304 por debajo del 1 %. Por host: `sticklive.eu` 27.087, `www.sticklive.eu` 4.387. Por robot: ordenador 66 %, smartphone 15 %.

**Mejoras.** Eventos: 3 elementos no válidos por falta de `location` (lo previsto en §11) y avisos por falta de `endDate`, `offers`, `image`, `description`, `performer` y `organizer`.

**Lectura.**
1. La causa raíz del desorden de canónicas es SEO-02 (metadata fuera del `<head>`) combinada con SEO-01 (enlaces sin idioma que redirigen con 307). Con una redirección temporal Google puede quedarse la URL de origen como canónica, y sin canonical propio en el `<head>` no hay nada que la contradiga.
2. España es el mercado (61 % de impresiones), pero `/es` es la versión menos indexada. Arreglar 1 debería mover a `/es` las impresiones que hoy van a URLs sin idioma y a `/en`.
3. Hay demanda real de jugadores por nombre. Confirma que no hay que desindexarlos en bloque, sino aplicar el umbral de §6 (y la decisión sobre menores).
4. Ya se están perdiendo URLs con tráfico por bajas sin redirección (DQ-02).
5. Con 59 clics no hay base estadística para decidir idiomas ni CTR. Esas decisiones siguen esperando (§17).

---

## 2. Mapa de la arquitectura SEO actual

```
Fuente (sidgad FEP / World Skate)
  → scraper (apps/scraper, JSON interno de sidgad + actas HTML)
  → ETL (apps/etl: upsert por source_ref, resolución de entidades, data_quality)
  → PostgreSQL (competitions, seasons, phases, rounds, matches, teams, clubs, players…)
  → API Hono (apps/api, pública en sticklive.eu/api/*, filtra data_quality='ok')
  → Next.js 16 SSR (apps/web/src/app/[locale]/…)
       ├─ generateMetadata: title, description, canonical, hreflang, OG/Twitter  (lib/seo.ts)
       ├─ opengraph-image.tsx / twitter-image.tsx por entidad (next/og)
       ├─ JSON-LD por página (WebSite+Organization en el layout, más uno por tipo)
       ├─ app/sitemap.ts (generateSitemaps por tipo y trozos de 8.000) ← API /meta/sitemap
       ├─ app/sitemap-index.xml/route.ts (índice propio, el que anuncia robots)
       └─ app/robots.ts
  → Caddy (HTTPS, www→apex 301, /api/* → API, resto → web)
```

Renderizado: todas las páginas públicas son SSR dinámicas. La ficha de competición se cachea en el borde 30 s (`next.config.mjs`), la home con `s-maxage=60`, el listado con 300. Equipo, jugador y partido salen con `private, no-cache, no-store` (cada visita de Googlebot renderiza, aunque los `fetch` a la API sí están cacheados entre 20 y 120 s).

Idiomas: todo vive bajo `/{es|en|pt|fr|it}/…`. El middleware redirige con 307 cualquier ruta sin prefijo según cookie, después `Accept-Language`, y si no hay nada a `en`. Googlebot no envía `Accept-Language`, así que siempre acaba en `/en`. `x-default` apunta a `/en`.

Sitemap (estado real el 16/10/2026): índice en `/sitemap-index.xml` con cinco secciones. `/sitemap.xml` devuelve 404 a propósito (documentado en el código).

| Sección | URLs | Entidades | Criterio de inclusión (`apps/api/src/routes/meta.ts`) |
|---|---:|---:|---|
| core | 15 | 3 | home, `/competitions`, `/privacy` |
| competitions-0 | 95 | 19 | `data_quality='ok'`, no archivada, alguna temporada ok con partidos |
| teams-0 | 1.730 | 346 | **todos los equipos**, sin filtro |
| players-0 | 8.335 | 1.667 | con alguna alineación, `LIMIT 10000` sin `ORDER BY` |
| matches-0 | 4.940 | 988 | `scheduled_at` en los últimos 60 días o futuro, temporada y competición ok, `LIMIT 3000` |
| **Total** | **15.115** | **3.023** | |

---

## 3. Inventario de tipos de página

| Tipo | Ruta | Existe | Indexable hoy | En sitemap | Contenido medido (palabras visibles, muestra) |
|---|---|---|---|---|---|
| Home | `/{l}` | Sí | Sí | Sí | ~200, agenda por días |
| Listado de competiciones | `/{l}/competitions` | Sí | Sí | Sí | ~270, 19 competiciones |
| Competición (temporada en curso) | `/{l}/competitions/{uuid}` | Sí | Sí | Sí | 89 a 1.613 (5 de 19 por debajo de 110) |
| Temporada anterior | `/{l}/competitions/{uuid}?season={uuid}` | Sí | No (canonical a la competición) | No | Clasificación y calendario completos de esa temporada |
| Equipo | `/{l}/teams/{uuid}` | Sí | Sí | Sí | 47 a 600, 62 equipos vacíos |
| Jugador | `/{l}/players/{uuid}` | Sí | Sí | Sí | 44 a 130 |
| Partido | `/{l}/matches/{uuid}` | Sí | Sí | Sí (ventana) | ~60 si no se ha jugado, más con acta |
| Búsqueda | `/{l}/search` | Sí | No (noindex) | No | |
| Privacidad | `/{l}/privacy` | Sí | Sí | Sí | ~440 |
| Login, ajustes, favoritos, premium, admin | | Sí | No (noindex + Disallow) | No | |
| Club (entidad que agrupa equipos) | — | **No** existe como página | | | Hay modelo `clubs` en BD (migración 044) pero no ruta pública |
| Clasificación, calendario o estadísticas como URL propia | — | **No**, son pestañas cliente dentro de la competición | | | |
| Jornada | — | **No** | | | |

Lo que el encargo da por posible y **no existe**: página de club, página de temporada indexable, página de clasificación o calendario independiente y página de jornada. No propongo crearlas todavía (§7).

---

## 4. Auditoría técnica — hallazgos

### SEO-01 · Enlaces internos sin idioma que pasan por una redirección 307
- **Problema:** todos los `<Link>` internos se emiten sin prefijo (`href="/competitions/{uuid}"`). El middleware los redirige con 307 y, para Googlebot, siempre a `/en`.
- **Evidencia:** en el HTML de `/es/competitions` los 33 enlaces a fichas son `/competitions/{uuid}`. `curl -A Googlebot https://sticklive.eu/competitions/ac2ef132-…` → `307 location: /en/competitions/ac2ef132-…`. Con `Accept-Language: es` → `/es/…`. La redirección no lleva `Vary`.
- **Afecta a:** todas las páginas, todos los idiomas.
- **Impacto:** cada enlace cuesta dos peticiones de rastreo, la señal de enlazado interno se concentra en `/en` (el idioma con menos público real para este deporte) y las versiones `es/pt/fr/it` quedan como páginas que Google solo conoce por sitemap y hreflang, sin enlaces internos directos. También rompe la coherencia "URL enlazada = URL canónica".
- **Severidad:** Alta · **Confianza:** Alta.
- **Solución:** un helper de enlace que antepone el locale activo (o un `LocaleLink` que envuelva `next/link`) y sustituir los `href` absolutos internos. Mantener el middleware para URLs sin prefijo que vengan de fuera (compartidas, imagen de alineación, push).
- **Validación:** test que renderiza las fichas y falla si aparece un `href="/(competitions|teams|players|matches)/` sin prefijo. En producción, `grep -c 'href="/es/'` > 0 y `grep -c 'href="/competitions/'` = 0 en `/es/competitions`. En Search Console, Estadísticas de rastreo → por respuesta: baja de las 307.

### SEO-02 · Metadatos fuera del `<head>` en cuanto la ficha no está en caché (metadata en streaming)
- **Problema:** Next 16 emite el `<title>`, el canonical y el hreflang en el `<body>` cuando `generateMetadata` no ha resuelto al enviar la cabecera del documento, salvo para los bots de su lista de "HTML limitado", que no incluye a Googlebot. En las fichas eso pasa siempre que la caché de datos está fría, que es justo lo que se encuentra Googlebot.
- **Evidencia:** 12 de 12 fichas de jugador pedidas en frío (6 con UA de Chrome y 6 con UA de Googlebot) tenían el canonical fuera del `<head>`, y 12 de 12 lo tenían dentro al repetir la petición. Con el UA de Googlebot para smartphone, en frío, competición, equipo, jugador y partido lo sirven fuera (por ejemplo, `</head>` en el carácter 1.438 y `<title>` en el 45.123). La home lo sirve dentro. Search Console confirma el efecto: canónica declarada "ninguna" y HTML rastreado sin `<title>` ni canonical en el `<head>` (§1b). En el primer rastreo de esta auditoría solo lo vi en 2 de 100 páginas porque las pedí con la caché ya caliente.
- **Afecta a:** competiciones, equipos, jugadores y partidos en todos los idiomas.
- **Impacto:** Google solo acepta `rel=canonical` en el `<head>`. Sin canonical, con hreflang ignorado y con enlaces internos que redirigen con 307, Google elige como canónica la URL sin idioma, marca `/en` como duplicada y apenas indexa `/es`.
- **Severidad:** Crítica · **Confianza:** Alta.
- **Solución:** desactivar la metadata en streaming para rastreadores con `htmlLimitedBots` en `next.config.mjs` (una expresión que incluya `Googlebot`, `Google-InspectionTool`, `Bingbot` y los que ya trae Next). Valorar servirla bloqueante a todos los agentes: cuesta algo de TTFB en frío pero elimina el problema de raíz. Después, pedir la validación de "Duplicada sin canónica" en Search Console.
- **Validación:** script que pide 50 fichas frías (ids no visitados en la última hora) con el UA de Googlebot para smartphone y comprueba que `<title>`, canonical y hreflang están antes de `</head>` en el 100 %. En Search Console, la inspección de `/es/competitions/{id}` debe mostrar la canónica declarada y el motivo "Duplicada sin canónica" debe vaciarse.

### SEO-03 · Un parámetro inválido provoca un 500
- **Problema:** `/es/teams/{uuid}?season=zzz` devuelve 500. La API responde 400 (`season must be a UUID`) y la página lo trata como caída.
- **Evidencia:** `curl` → 500. Con un UUID bien formado pero inexistente → 200.
- **Impacto:** cualquier enlace externo mal copiado genera 5xx, que reduce la frecuencia de rastreo del host. Bajo en volumen, malo en señal.
- **Severidad:** Media · **Confianza:** Alta.
- **Solución:** validar `season` en la página y, si no es un UUID, ignorarlo (o 404 si se prefiere). No convertir un 400 de la API en 500.
- **Validación:** test de la página con `season` no UUID → 200 con la temporada por defecto.

### SEO-04 · UUID en mayúsculas sirve un duplicado auto-canónico
- **Evidencia:** `/es/teams/FA1575FB-…` → 200 con `canonical` en mayúsculas.
- **Impacto:** bajo hoy (nadie enlaza así), pero es un duplicado indexable.
- **Severidad:** Baja · **Confianza:** Alta.
- **Solución:** normalizar a minúsculas con 301 en el middleware, o canonical siempre en minúsculas.

### SEO-05 · Descripción y `og:url` heredadas del layout
- **Evidencia:** `/es/competitions`, `/es/search` y `/es/privacy` sirven la descripción de la home. `/es/search` declara `og:url = https://sticklive.eu/es`.
- **Severidad:** Baja · **Confianza:** Alta.
- **Solución:** `description` y `socialMeta` propios en esas tres páginas.

### SEO-06 · Si falla la API, el título de una ficha es el de la home
- **Problema:** el `catch` de `generateMetadata` en las cuatro fichas devuelve solo `alternates`, así que hereda el título y la descripción de la home.
- **Impacto:** si la API falla solo en la metadata y la página se renderiza, Google ve una ficha con título de home (duplicado). Si falla también la página, sale un error.
- **Severidad:** Media · **Confianza:** Alta en el código, Media en la frecuencia.
- **Solución:** en el `catch`, `robots: { index: false }` y un título neutro de error, o propagar el error para que la respuesta sea 5xx y Google reintente. Nunca 200 con metadatos de otra página.

### SEO-07 · Sitemap que se vacía en silencio si la API no responde
- **Problema:** `fetchSitemapIds` devuelve listas vacías ante cualquier error, el índice pasa a declarar solo `core` y la respuesta se cachea una hora (`s-maxage=3600`).
- **Impacto:** en una caída o un despliegue, Google puede leer un sitemap de 15 URLs en vez de 15.115. No desindexa por sí solo, pero es una señal de retirada masiva y confunde el seguimiento en Search Console. Contradice la regla del proyecto de que los fallos de fuente sean explícitos.
- **Severidad:** Media · **Confianza:** Alta.
- **Solución:** si la API falla, responder 503 con `Retry-After` en índice y secciones (Google reintenta y conserva la versión anterior). Añadir alerta si el número de URLs cae más de un 20 % respecto a la última generación.

### SEO-08 · `lastmod` que cambia en cada pasada del ETL
- **Evidencia:** 4.865 de 4.940 URLs de partido tienen `lastmod` entre las 14:00 y las 15:00 UTC del 16/10, incluidas las de partidos a meses vista sin cambios. En equipos, 495 de 1.730 en esa misma hora.
- **Causa probable:** los upserts actualizan `updated_at = NOW()` aunque el registro no cambie (hay varios `updated_at = NOW()` sin condición en el ETL).
- **Impacto:** Google aprende que el `lastmod` del sitio no es fiable y lo ignora, justo lo contrario de lo que se buscaba en #337.
- **Severidad:** Media · **Confianza:** Alta en el síntoma, Media en la causa.
- **Solución:** actualizar `updated_at` solo cuando cambia algún campo visible (`WHERE … IS DISTINCT FROM`) o calcular `lastmod` como el máximo de cambios reales (marcador, estado, eventos, alineación).
- **Validación:** dos pasadas seguidas del ETL sin cambios en la fuente no deben mover ningún `lastmod`.

### SEO-09 · Sitemap sin criterio de calidad para equipos y jugadores
- **Problema:** equipos entran todos. Jugadores entran si tienen alguna alineación, con un `LIMIT 10000` sin orden (cuando se supere, el conjunto publicado será aleatorio entre generaciones).
- **Evidencia:** §5, DQ-03 y DQ-05.
- **Severidad:** Alta · **Confianza:** Alta.
- **Solución:** la misma función de elegibilidad que decide `index/noindex` (§6) decide la entrada en el sitemap. Orden determinista.

### SEO-10 · Imagen OG de partido con escudos en blanco
- **Problema:** la tarjeta de partido muestra dos círculos blancos en lugar de los escudos.
- **Evidencia:** `/es/matches/5733c971-…/opengraph-image` renderizada y revisada. El escudo se pide a `/api/teams/{id}/logo`, que responde `image/webp`, y el motor de `next/og` (Satori) no admite WebP.
- **Afecta a:** todas las OG de partido y cualquier OG que use el escudo servido por la API.
- **Impacto:** al compartir en WhatsApp o Telegram la tarjeta parece rota. Es la superficie de crecimiento orgánico más directa que tiene el producto.
- **Severidad:** Alta para producto, Baja para Google · **Confianza:** Alta.
- **Solución:** que la ruta de OG pida el escudo en PNG (parámetro `?format=png` en la API o lectura directa del PNG normalizado del volumen). Si no hay escudo, iniciales del equipo, nunca un círculo vacío.
- **Validación:** test que genera la OG de un partido con escudo y comprueba que el área del escudo no es uniforme. Revisión manual en el depurador de Meta.

### SEO-11 · Imágenes OG sin caché HTTP, lentas y solo en español
- **Evidencia:** todas responden `cache-control: public, max-age=0, must-revalidate`. Tiempos medidos entre 0,8 y 4,3 s. Para `/en/…` el texto sigue en español ("Hockey patines en directo", fecha con `es-ES`, "Local", "Visitante"). Para entidades inexistentes devuelven 200 con tarjeta genérica (correcto como fallback).
- **Severidad:** Media · **Confianza:** Alta.
- **Solución:** `Cache-Control: public, s-maxage=…` acorde al `revalidate` de cada una (la URL ya lleva `?v=` versionado por estado), textos y fecha por locale.

### SEO-12 · Rendimiento (laboratorio)
- **Evidencia:** Lighthouse móvil, 16/10: home rendimiento 39 (LCP 5,2 s, TBT 2,45 s, CLS 0,18), competición 49 (LCP 5,2 s, TBT 1,98 s), equipo 60, partido 57. SEO 100 y accesibilidad 96-100 en las cuatro. El mayor bloque de JS es un chunk de ~2,3 s de CPU y AdSense añade ~1 s de hilo principal. El CLS de la home viene de una `section.card` que salta al cargar.
- **Impacto:** el TBT alto anticipa un INP malo en móviles modestos. No es un bloqueante de indexación, sí de experiencia y de la señal de página.
- **Severidad:** Media · **Confianza:** Media (laboratorio, no CrUX).
- **Solución:** medir primero con datos reales (informe de Core Web Vitals de Search Console o CrUX), después atacar el chunk principal y la carga de AdSense (diferirla tras interacción o tras consentimiento) y reservar altura en la tarjeta de la home.

### SEO-13 · Sin señales de confianza ni atribución de la fuente
- **Evidencia:** ninguna página rastreada menciona de dónde salen los datos (FEP, World Skate), no hay página "Sobre Stick Live", ni contacto visible, ni aviso legal. Sí hay política de privacidad.
- **Impacto:** E-E-A-T débil en un sitio de datos, y atribución de fuente probablemente exigible (§11).
- **Severidad:** Media · **Confianza:** Alta.
- **Solución:** pie de página con fuente por competición ("Datos: Real Federación Española de Patinaje"), página "Sobre" con metodología de datos y correcciones, contacto.

### SEO-14 · Hreflang a cinco idiomas con el contenido principal igual
- **Evidencia:** misma ficha de OK Liga Masculina en `es` y en `it`: 96 % de similitud de tokens. Los nombres de competición, equipos y rondas salen tal cual de la fuente ("Histórico" sin traducir en italiano, "JORNADA 1"). En partidos sin jugar la similitud baja al 40 % porque casi todo el texto es interfaz.
- **Impacto:** 4 de cada 5 URLs del sitemap son variantes de idioma. Google puede tratarlas como duplicadas y elegir otra canónica. No es spam en sí (hay interfaz traducida y hreflang correcto), pero multiplica por cinco el peso de cualquier página floja.
- **Severidad:** Media · **Confianza:** Media (hay que mirarlo en Search Console por idioma).
- **Solución:** no tocar todavía. Medir en Search Console impresiones por carpeta de idioma y el motivo "Duplicada: Google ha elegido otra canónica" por idioma. Si `fr` o `en` no reciben impresiones en 8 semanas, valorar sacarlos del sitemap y del hreflang (manteniéndolos accesibles). Mientras, traducir los textos de datos enumerables (rondas, fases, "Histórico").

### SEO-15 · Cosas que están bien y conviene no romper
Canonical auto-referente en todas las fichas, hreflang recíproco con `x-default` igual en HTML y sitemap, 404 reales para ids inexistentes (UUID válido o no), 308 para barra final, `www` → apex con 301, redirección 308 de URLs antiguas por id de temporada a la competición (#350), `robots.txt` y `noindex` en zonas privadas, `alt` en todas las imágenes de la muestra, JSON-LD escapado, sitemap por secciones bajo el límite de 50.000.

---

## 5. Auditoría de scraping y calidad de datos

### 5.1 Flujo y puntos de control actuales

| Tramo | Qué hay hoy | Hueco para SEO |
|---|---|---|
| Fuente → scraper | Cliente sidgad con reintentos, estado solo por señal explícita, batería de casos reales en CI | El scraper usa UA de navegador y Referer falsificado para imágenes (§11) |
| Scraper → ETL | Upsert por `source_ref`, eventos con identidad por contenido, resolución de entidades en cascada con cola HITL | Fusiones y separaciones de entidades no registran el id que desaparece |
| ETL → BD | `data_quality` por competición y temporada, `integrity-check` diario, watchdog de directos, `scrape_logs` | `updated_at` se mueve sin cambios reales (SEO-08). No hay estado "verificado" a nivel de partido |
| BD → API | Todas las lecturas públicas filtran `data_quality='ok'` (competición y temporada) | El detalle de equipo no filtra y `/meta/sitemap` incluye todos los equipos |
| API → web | 404 si la API da 404, error si da otra cosa | Un 400 de la API acaba en 500 (SEO-03). Metadata de fallback = home (SEO-06) |
| Web → metadatos | Nombres directos de BD con `clubName()`/`toTitleCase()` | Normalización algorítmica que estropea siglas y no sabe de orden de apellidos |
| Web → sitemap | Ventanas y filtros en SQL | Sin umbral de contenido, sin detección de caídas bruscas |

### 5.2 Hallazgos de datos

**DQ-01 · Ocultar por calidad es desindexar.** Marcar una temporada `en_revision` hace que la API devuelva 404 en partidos y que desaparezca de fichas de equipo y jugador. Para Google es una baja. Si la revisión dura horas o días y luego se reabre, las URLs tienen que volver a ganarse. Severidad alta, confianza alta. Es justo el caso que el encargo pide evitar: un problema de datos temporal no debe producir una desindexación. Propuesta en la política de §5.3.

**DQ-02 · Bajas sin redirección.** Hay scripts que borran o fusionan entidades (`merge-canonical-competitions.ts`, `split-filial-teams.ts`, `cleanup-synthetic-dupes.ts`, la fusión del Liceo duplicado del 23/06) y no existe tabla de redirecciones. El reset del 16/06 cambió todos los UUID sin mapa de equivalencias y sin copia de seguridad, así que cualquier URL anterior a esa fecha es hoy un 404 sin destino posible. Severidad alta, confianza alta.

**DQ-03 · Equipos vacíos y duplicados.** De 346 equipos en el sitemap: 62 sin partidos ni plantilla (45 clubes y 17 selecciones, por ejemplo "NAVARRA", "CANTABRIA", "Mozambique", "SD ESPANYOL"), 39 sin ninguna temporada visible y 29 grupos de nombre repetido. En los duplicados hay dos casos distintos:
- Selecciones por categoría: "Italia" son cinco equipos (masculina y femenina, absoluta, sub-17, sub-19) con el mismo título y la misma OG. Son entidades correctas con un nombre visible insuficiente.
- Clubes duplicados de verdad: "CH MATARÓ" femenino absoluto y otro sin género ni categoría, lo mismo con "Martinelia Manlleu", "Telecable Hockey Club", "Club Patín Las Rozas"… y variantes de escritura que son el mismo club ("C.P. TARADELL" y "CP TARADELL", "H.C.  LLEIDA.NET ALPICAT", "HC LLEIDANET ALPICAT" y "LLEIDANET HC ALPICAT"). Son residuos de resolución de entidades.
Además 214 equipos no tienen género ni categoría y 332 no tienen ciudad. Severidad alta, confianza alta.

**DQ-04 · Partidos.** De 988 partidos en el sitemap: 840 programados, 146 terminados y 2 en directo en el momento del volcado. 457 programados están a más de 90 días. Ninguno tiene sede (`venue` nulo en los 988). Los 146 terminados tienen acta completa (eventos y alineaciones), así que la parte jugada es sólida. 77 partidos comparten título con otro (ida y vuelta, o el mismo cruce en Supercopa y Liga: "CP Vila-sana Coop D'ivars - Generali HC Palau" el 23/10 en Supercopa y el 20/02 en OK Liga Femenina dan el mismo `<title>`). No encontré partidos programados vencidos ni directos atascados, el watchdog y el `integrity-check` funcionan. Confianza alta.

**DQ-05 · Jugadores.** 1.667 en el sitemap. Ninguno tiene fecha de nacimiento ni nacionalidad (100 % nulos). 96 sin ninguna temporada visible y 91 con cero partidos en la temporada. 556 sin foto. 82 tienen el Mundial Sub-19 en su historial, y las ligas Plata y Bronce también tienen jugadores menores, sin forma de saberlo. Hay nombres con el orden roto ("Luis Cortes García José", "Florencia Felamini María"), lo que apunta a un problema de partición nombre/apellidos en la fuente o en el parser. Durante el volcado, 14 de 1.667 peticiones a `/api/players/{id}` dieron 500/502 con solo 4 peticiones concurrentes y respondieron bien después: el endpoint tarda ~1,3 s y es frágil bajo carga moderada (confianza media, la carga la generé yo).

**DQ-06 · Nombres de presentación.** La fuente da casi todo en mayúsculas (294 de 346 equipos). La web normaliza con reglas genéricas que fallan con siglas ("C.e. Noia Freixenet" en vez de "CE Noia Freixenet", "Club Patin Esneca Fraga" sin tilde) y deja títulos de competición en mayúsculas ("OK LIGA PLATA FEMENINA 2026/27") salvo cuando existe traducción ("OK Liga Femenina"). Ya existe `competitions.name_i18n` (migración 038), pero los titles no lo usan de forma uniforme.

**DQ-07 · Temporadas en curso sin datos todavía.** "OK LIGA MASCULINA 2026/27" muestra la clasificación con todo a cero y "SUPERCOPA DE ESPAÑA MASCULINA 2026/27" tiene 90 palabras. Es correcto como dato, pero hace que la página principal de cada competición pierda contenido justo en el cambio de temporada, mientras la temporada anterior completa queda detrás de `?season=` con canonical a la actual.

### 5.3 Política propuesta por estado del dato

| Estado | Definición operativa | Página | HTTP | Indexación | Sitemap | Metadatos y JSON-LD |
|---|---|---|---|---|---|---|
| Verificado | Temporada y competición `ok`, partido con resultado de la fuente o acta | Normal | 200 | index | Sí | Completos, con marcador si está terminado |
| Incompleto | Faltan datos no esenciales (sin acta, sin sede, sin escudo) | Normal, sin bloques vacíos | 200 | index si cumple el mínimo de su tipo (§6) | Según mínimo | Solo lo confirmado, nunca rellenos |
| Temporalmente no disponible | Fuente caída, scraper con error, revisión corta (< 72 h) | Última versión buena con aviso "datos en actualización" | 200 | Sin cambios | Sin cambios | Sin cambios |
| En revisión larga | `en_revision` más de 72 h o dato sospechoso de ser erróneo | Ficha mínima sin el dato dudoso y con aviso | 200 | noindex mientras dure | Fuera | Sin marcador ni datos dudosos |
| Obsoleto | Temporada terminada, competición archivada | Normal, marcada como histórica | 200 | index si cumple el mínimo | Sí (sección histórica, `lastmod` estable) | Con temporada explícita |
| Duplicado | Dos entidades que son la misma | La perdedora deja de existir | 301 a la superviviente | — | Solo la superviviente | — |
| Eliminado en la fuente | Desaparece de la fuente pero existió | Se conserva si se jugó, se marca "no disponible en la fuente" | 200 | index si se jugó, noindex si nunca se jugó | Fuera si noindex | Sin cambios |
| Creado por error | Nunca existió (sintético, test, importación revertida) | — | 410 | — | Fuera | — |
| Corregido tras publicar | La fuente cambia un resultado ya publicado | Se aplica y queda registro | 200 | Sin cambios | `lastmod` = momento de la corrección | La OG cambia de versión (`?v=`) |

Reglas de seguridad: ninguna acción de desindexación (noindex, 404, 410) se dispara automáticamente desde el scraper. Solo desde una acción explícita de curación en el panel admin o desde la tabla de redirecciones. Una caída de volumen de URLs publicables de más de un 20 % entre dos generaciones bloquea la publicación del nuevo sitemap y avisa.

### 5.4 Controles automáticos de datos que propongo
1. **Tabla `entity_redirects`** (`entity_type`, `old_id`, `new_id` nullable, `reason`, `created_at`). La escriben los scripts de fusión, separación y limpieza. El middleware o la página la consultan antes de dar un 404: si hay `new_id` → 301, si no → 410.
2. **Puerta de publicación de metadatos**: función pura `pageEligibility(entity)` que devuelve `{ indexable, inSitemap, reasons[] }` y que usan a la vez la página (`robots`), el sitemap y los tests. Una sola fuente de verdad.
3. **Validaciones antes de pintar un marcador** en título, OG o JSON-LD: estado `finished` o `live`, ambos marcadores no nulos, y para `finished` coherencia con `winner_team_id` (ya hay restricción desde la migración 059). Hoy el título usa `score ?? 0`: si un directo llega sin marcador, se publicaría "0-0".
4. **Nombre de presentación curado**: columna `display_name` (o reutilizar `name_i18n`) en equipos y competiciones, rellenada por el ETL con reglas conocidas (siglas CP, CH, HC, CE, CD…) y corregible desde el admin. La web deja de normalizar por su cuenta.
5. **Desambiguación de selecciones**: el nombre visible de un equipo nacional incluye género y categoría cuando hay más de uno con el mismo país ("Italia sub-19 masculina").
6. **Comprobación diaria** (ampliar `integrity-check`): equipos sin partidos ni plantilla, grupos de nombre duplicado nuevos, jugadores sin temporadas visibles, partidos programados a más de N días sin ronda, conteo de URLs elegibles por tipo con alerta si cae más de un 20 %.

---

## 6. Matriz de indexación por tipo de página

Distingo cuatro niveles: **accesible** (responde 200 a quien tenga la URL), **rastreable** (no bloqueada por robots y enlazada o en sitemap), **indexable** (sin `noindex`, canonical a sí misma) y **merece aparecer en Google** (hay demanda plausible y la página la satisface mejor que la fuente).

| Tipo | Objetivo de búsqueda e intención | Mínimo para publicar | Mínimo para indexar | Canonical | Sitemap | Enlaces internos necesarios | ¿Merece Google? |
|---|---|---|---|---|---|---|---|
| Home `/{l}` | Marca, "hockey patines en directo", "resultados hockey patines hoy" | Siempre | Siempre | Sí misma | Sí | Competiciones principales y partidos del día con idioma | Sí |
| Listado `/{l}/competitions` | "competiciones hockey patines", navegación | Siempre | Siempre | Sí misma | Sí | Todas las competiciones activas | Sí |
| Competición (temporada en curso) | "OK Liga clasificación", "calendario OK Liga Plata", "resultados Copa del Rey hockey patines" | Temporada visible | Calendario publicado con fechas o clasificación con al menos una jornada jugada | Sí misma, sin `?season` | Sí | Equipos de la temporada, partidos de la jornada, temporada anterior | Sí. Es la página con más demanda del sitio |
| Temporada anterior (`?season=`) | "OK Liga 2025/26 clasificación final" | Temporada visible | Hoy no (canonical a la actual). Ver §7 | Competición | No | Desde la competición y el equipo | Sí cuando la temporada esté completa y verificada, más adelante |
| Equipo | "CP Tordera hockey", "calendario Reus Deportiu" | Existe | Al menos una temporada visible de las dos últimas con partidos, o plantilla. Selecciones solo si nombre desambiguado | Sí misma, sin `?season` | Solo si indexable | Competición actual, últimos y próximos partidos, plantilla | Sí para clubes con competición activa |
| Jugador | "Marc Castañer hockey", "goleadores OK Liga" | Existe | Categoría absoluta, al menos una temporada visible y 5 partidos jugados. Nunca categorías sub-19 o inferiores ni jugadores sin edad conocida en competiciones con menores, hasta decisión legal | Sí misma | Solo si indexable | Equipo actual, competición | Para una minoría (jugadores de OK Liga y OK Liga Femenina, selecciones absolutas). No para el resto hoy |
| Partido jugado | "Liceo Reus resultado", "Igualada Barça hockey" | Existe | Terminado con marcador verificado | Sí misma | Sí, últimos 60 días | Competición, ambos equipos, jornada | Sí, sobre todo en las 72 h posteriores |
| Partido próximo | "Liceo Reus hora", "a qué hora juega…" | Existe con equipos confirmados | Equipos y fecha confirmados | Sí misma | Solo los próximos 14 días | Competición, ambos equipos | Sí en la semana del partido. Fuera de esa ventana, poco |
| Partido aplazado o cancelado | "partido aplazado…" | Existe | Igual que el próximo, con el estado visible | Sí misma | Si está en ventana | | Poco, pero no hay que esconderlo |
| Búsqueda | — | Siempre | Nunca | — | No | — | No |
| Privacidad | Legal | Siempre | Sí | Sí misma | Sí | Pie de página | Irrelevante |
| Zonas privadas | — | Según sesión | Nunca | — | No | — | No |

Sobre páginas sin datos: una página accesible que no cumple el mínimo para indexar se sirve con 200 y `noindex, follow` (sigue repartiendo enlaces) y no entra en el sitemap. No se borra ni se redirige.

Sobre partidos próximos lejanos: no los marco `noindex`. Pasar de `noindex` a `index` en la semana del partido llega tarde porque Google tarda en volver a rastrear. Basta con no incluirlos en el sitemap hasta 14 días antes y enriquecer la ficha con datos reales (§8).

**Impacto estimado de aplicar la matriz al sitemap actual** (hipótesis con los datos del 16/10): equipos de 346 a unos 280, partidos en sitemap de 988 a unos 300 (146 jugados en ventana más los 32 de los próximos 7 días y parte de los 121 a 30 días), jugadores de 1.667 a unos pocos cientos. El sitemap bajaría de ~15.000 a ~4.000-5.000 URLs, sin borrar ninguna página.

---

## 7. Estrategia de URLs, canonical y sitemaps

**URLs.** Hoy todas las fichas usan UUID (`/es/teams/fa1575fb-4093-4180-bbed-aa2257219817`). Las URLs legibles con slug (ya hay `slug` en competiciones y equipos) dan un beneficio pequeño en Google y algo más en CTR y al compartir, pero cambiarlas obliga a migrar con 301 todo lo que ya esté indexado. Recomendación: **no cambiar todavía**. Primero sanear el contenido indexable y tener 8 semanas de datos de Search Console. Si después se decide, el patrón sería `/{l}/{tipo}/{slug}-{idcorto}` resolviendo siempre por el id y con 301 si el slug no coincide, para que un cambio de nombre de club no rompa nada. Los segmentos de ruta se quedan en inglés en todos los idiomas (traducirlos multiplica el mantenimiento sin beneficio claro).

**Canonical.** Mantener la regla actual (auto-referente, sin parámetros) y añadir: normalización a minúsculas (SEO-04), canonical a la entidad superviviente cuando se use un id fusionado (vía 301, no vía canonical), y que la canonical nunca dependa de una llamada a la API que pueda fallar (si falla, `noindex`, SEO-06).

**Temporadas anteriores.** Hoy son `?season=` con canonical a la temporada en curso. Es la decisión correcta mientras el histórico no esté verificado. Cuando lo esté (o cuando la temporada en curso tenga poco contenido, DQ-07), la opción buena es una ruta propia `/{l}/competitions/{id}/{temporada}` indexable para temporadas terminadas y completas. La decisión depende del histórico, que hoy es opcional (§13).

**Sitemaps.**
- La misma función de elegibilidad para la página y el sitemap.
- Secciones nuevas: `matches-recent` (jugados en 60 días), `matches-upcoming` (14 días) y, más adelante, `seasons-archive`. Así el informe de sitemaps de Search Console dice cuánto se indexa de cada tipo.
- `lastmod` solo con cambios reales (SEO-08).
- 503 si la API falla, nunca un sitemap degradado (SEO-07).
- Quitar `changefreq` y `priority`: Google los ignora y no aportan nada.

**URLs ya indexadas antes de cualquier cambio.**
1. Exportar de Search Console el informe de páginas (indexadas y no indexadas, con ejemplos) y el de rendimiento por página de los últimos 3 meses (§12).
2. Cruzar con la matriz: toda URL con clics o impresiones relevantes que la matriz sacaría del índice se revisa a mano antes de aplicar `noindex`.
3. Aplicar los cambios por tipo y por fases (primero sitemap, después `noindex`), con una semana de observación entre fases.
4. Las URLs anteriores al reset del 16/06 no tienen equivalencia posible (no hay mapa de UUID antiguos). Si el informe de enlaces muestra alguna con enlaces externos valiosos, se redirige a mano a la entidad nueva. El resto se deja en 404, que es lo correcto.

---

## 8. SEO programático sin contenido artificial

Principio: cada frase sale de un dato calculado o de la fuente, y si el dato no existe la frase no se escribe. Nada de párrafos de relleno. Si una ficha no llega al mínimo, la respuesta es mejorar el producto o no indexarla.

### 8.1 Plantillas por entidad

**Competición (temporada en curso).** Bloques, en este orden y solo si hay datos:
1. Resumen de estado generado (ejemplo hipotético): "Jornada 7 de 26 · Líder: Barça (19 pts) · Próxima jornada: sáb 22 nov". Requiere clasificación con al menos una jornada jugada y calendario con fecha.
2. Clasificación (ya existe).
3. Resultados de la última jornada y partidos de la próxima, enlazados.
4. Líderes estadísticos (goleadores) si `season-stats` tiene datos.
5. Formato de la competición derivado de las fases reales (liga regular + playoff, final four…). Ya existe el modelo `phases`.
6. Enlace a la temporada anterior con su campeón, si la temporada anterior está completa.
7. Atribución: "Datos: RFEP" o "World Skate".
Omitir si no hay datos: líderes, formato si la fase está en fallback, campeón anterior si la temporada anterior no está verificada.

**Equipo.** Competición y posición actuales, último resultado y próximo partido con fecha, racha de los últimos 5 (calculada), máximos goleadores del equipo en la temporada, historial de temporadas con posición final, club al que pertenece y sus otros equipos (ya existe `clubTeams`). Omitir ciudad, sede o web si son nulos (hoy lo son casi siempre).

**Partido próximo.** Fecha y hora en la zona de la competición, competición y jornada, posición de ambos en la clasificación, últimos 5 de cada uno, enfrentamientos previos que estén en la base de datos (con la temporada indicada), y enlace a la ficha del rival. Esto lleva un partido de 60 palabras a algo útil con datos que ya existen.

**Partido jugado.** Marcador, goles con minuto, tarjetas, alineaciones, cómo queda la clasificación tras el partido. Ya existe casi todo. Frase de resumen generada solo con hechos (hipotético: "Remontada del Liceo, que perdía 0-2 al descanso") si se calculan de los eventos, nunca adjetivos sin respaldo.

**Jugador.** Equipo actual y dorsal, temporadas con partidos, goles, asistencias y tarjetas por competición (ya existe), posición en la tabla de goleadores de su liga si está en el top 20. Sin biografía, sin edad inventada.

### 8.2 Reglas comunes
- Longitud: la que den los datos. No hay mínimo de palabras como objetivo, el mínimo es de datos (matriz §6).
- Dato desconocido: no se pinta el bloque. Nunca "Sin datos", "N/D" o "0" como sustituto, salvo que el cero sea real.
- Contradicciones: el resumen generado y la tabla salen de la misma consulta. Un test compara que el líder del resumen es el primero de la clasificación.
- Fechas: siempre con la zona de la competición (`match-time.ts` ya es la autoridad).
- Textos enumerables (rondas, fases, estados) traducidos por clave, no copiados de la fuente.

### 8.3 Ejemplos reales del 16/10/2026

| Página | Estado hoy | Veredicto |
|---|---|---|
| OK Liga Femenina 2026/27 (`/es/competitions/9bc7cb2c-…`) | 1.573 palabras, clasificación, jornadas, 196 enlaces | Buena. Indexar |
| CP Tordera (`/es/teams/fa1575fb-…`) | 600 palabras, resultados de dos ligas | Buena. Indexar. Le falta resumen y posición |
| Australia - Brasil, Intercontinental WSG (`/es/matches/d8cd47f7-…`) | Terminado 3-7, acta completa | Buena. Indexar |
| Supercopa de España Masculina 2026/27 | 90 palabras, 2 partidos | Insuficiente hoy. Indexable cuando tenga resultados. Mientras, enlazar desde ella al histórico |
| CP Vila-sana - Cata CP Voltrega, 5/12/2026 | 60 palabras, solo equipos y hora | Insuficiente. Indexable pero fuera del sitemap hasta 14 días antes, y enriquecer con forma y clasificación |
| Marc Castañer Pascual (`/es/players/4c62b41c-…`) | 44 palabras | No indexar con el contenido actual |
| NAVARRA (`/es/teams/dd961034-…`) | 47 palabras, 0 temporadas, 0 partidos, 0 jugadores | No indexar. Revisar si la entidad debe existir |
| "Italia" (cinco equipos con el mismo título) | Títulos idénticos | No indexar hasta desambiguar el nombre |

---

## 9. Titles, meta descriptions y snippets

### 9.1 Reglas
- Patrón `{qué} {contexto} | Stick Live`, con el separador `|` en todas las páginas (hoy conviven `|`, `·` y `—`).
- Nombres desde el nombre de presentación curado (DQ-06), nunca en mayúsculas de la fuente.
- Marcador en el título solo si el partido está `finished` y ambos marcadores son no nulos. En directo, el título no lleva marcador (Google lo guardaría desactualizado). El marcador en directo vive en la página y en la OG.
- Fecha en el título del partido siempre (desambigua ida y vuelta y cruces entre competiciones).
- Temporada en el título de competición solo cuando hay más de una temporada visible.
- Longitud objetivo 50-65 caracteres. Si no cabe, se recorta el nombre del patrocinador del equipo antes que la competición.
- Descripción: generarla solo cuando aporta datos concretos de esa página (líder, jornada, marcador, próximo partido). Si la página no tiene datos que la distingan, mejor omitir `description` y dejar que Google elija un fragmento del contenido visible, en vez de repetir la plantilla "X: clasificación, calendario, resultados…" en 3.000 URLs.
- Nunca "en directo" en la descripción de un partido terminado o lejano (hoy todas las fichas de partido lo dicen).

### 9.2 Especificación por tipo, con ejemplos reales

| Tipo | Title (patrón) | Ejemplo hoy | Ejemplo propuesto |
|---|---|---|---|
| Competición | `{Competición} {temporada}: clasificación y resultados \| Stick Live` | `OK LIGA MASCULINA 2026/27 \| Stick Live` | `OK Liga Masculina 2026/27: clasificación y resultados \| Stick Live` |
| Equipo club | `{Equipo}: calendario, resultados y plantilla \| Stick Live` | `C.e. Noia Freixenet \| Stick Live` | `CE Noia Freixenet: calendario y resultados \| Stick Live` |
| Selección | `{País} {categoría} {género} \| Stick Live` | `Italia \| Stick Live` (×5) | `Italia sub-19 masculina: Mundial 2026 \| Stick Live` |
| Partido jugado | `{Local} {g}-{g} {Visitante} · {Competición} ({fecha}) \| Stick Live` | `Australia 3-7 Brasil \| Stick Live` | `Australia 3-7 Brasil · Intercontinental WSG (16 oct 2026) \| Stick Live` |
| Partido próximo | `{Local} - {Visitante}: {Competición}, {fecha} \| Stick Live` | `CP Vila-sana Coop D'ivars - Generali HC Palau \| Stick Live` (dos partidos distintos con este título) | `Vila-sana - Palau: Supercopa Femenina, 23 oct 2026 \| Stick Live` |
| Jugador | `{Nombre}: estadísticas con {Equipo} \| Stick Live` | `Luis Cortes García José \| Stick Live` | Primero corregir el nombre. Después, por ejemplo, `Luis José Cortes García: estadísticas con Club Promoción Patín Raspeig \| Stick Live` (orden correcto por confirmar en la fuente) |

Descripciones propuestas (solo con datos). Las cifras de posición y jornada de estos ejemplos son **hipotéticas**, el resto es real:
- Competición con datos: "Jornada 7 de 26. Líder: Barça con 19 puntos. Resultados de la última jornada y calendario hasta mayo." Sin datos de jornada jugada: omitir `description`.
- Partido jugado: "Australia ganó 3-7 a Brasil en el Intercontinental Masculino de los WSG Asunción 2026. Goles, alineaciones y tarjetas."
- Partido próximo: "Sábado 5 de diciembre a las 19:00. Vila-sana (6.º) recibe al Voltrega (2.º) en la jornada 9 de la OK Liga Femenina." Solo si las posiciones existen.

Cambio de temporada: el título de la competición cambia de temporada cuando cambia `is_current`. Si la temporada nueva aún no tiene partidos jugados, el título lo dice ("calendario 2026/27") en lugar de prometer clasificación.

---

## 10. Open Graph y contenido al compartir

### 10.1 Estado
Ya existe casi todo: `og:title`, `og:description`, `og:type`, `og:url`, `og:image` con dimensiones, `og:site_name`, `og:locale`, Twitter `summary_large_image`, imágenes dinámicas por partido, equipo, jugador y competición con versión `?v=` por estado, y la imagen de marca `og-image-v2.png` como respaldo. Fallos: escudos en blanco (SEO-10), sin caché HTTP y lento (SEO-11), textos solo en español, `og:url` heredado en búsqueda (SEO-05) y `og:url` con `?season=` mientras el canonical no lo lleva (aceptable, la URL compartida debe abrir esa temporada).

### 10.2 Merece la pena la OG dinámica
Sí. En un deporte de nicho la distribución real es WhatsApp y Telegram entre aficionados, y una tarjeta con escudos y marcador es el mejor anuncio del producto. La condición es que nunca muestre un dato incorrecto.

Reglas:
- Fuente de datos: la misma llamada y la misma validación que el título (§5.4 punto 3). Si el marcador no pasa la validación, la tarjeta muestra "VS" y la fecha.
- Escudo: PNG local normalizado. Sin escudo, círculo con las iniciales del nombre de presentación. Nunca una imagen remota de la fuente en tiempo de render.
- Tiempo: objetivo < 1 s. Caché en el borde con `s-maxage` igual al `revalidate` de cada tipo (30 s partido en directo, 1 día partido terminado, 1 h equipo y competición). La URL versionada con `?v=` permite cachear largo sin servir algo viejo.
- Si la generación falla: 302 a la imagen de marca estática, no un error.
- Textos por locale (fecha, "EN DIRECTO", "FINAL", subtítulos).

### 10.3 Cómo se vería al compartir

Equipos, competiciones, fechas y el marcador de Australia-Brasil son reales. Posiciones, líderes y rivales próximos son **hipotéticos**.

- **Partido (terminado)**: título "Australia 3-7 Brasil", descripción "Intercontinental Masculino · WSG Asunción 2026 · Final", imagen con ambos escudos, marcador grande, "FINAL · 16 oct" y la franja de marca.
- **Partido (próximo)**: título "Vila-sana - Voltrega · sáb 5 dic, 19:00", descripción "OK Liga Femenina, jornada 9", imagen con escudos, "VS" y fecha y hora.
- **Equipo**: título "CP Tordera", descripción "OK Liga Plata Norte · 4.º · Próximo: vs Manlleu, sáb 18:00", imagen con escudo grande, nombre y competición actual.
- **Competición**: título "OK Liga Masculina 2026/27", descripción "Jornada 7 · Líder: Barça", imagen con el nombre y el top 3 de la clasificación si hay al menos una jornada jugada, si no solo nombre y temporada.

---

## 11. Datos estructurados

| Página | Hoy | Valoración | Propuesta |
|---|---|---|---|
| Todas | `WebSite` + `Organization` (nombre, url, logo) | Válido y útil para la marca | Mantener. No añadir `SearchAction`, Google retiró el cuadro de búsqueda de sitelinks |
| Competición | `SportsLeague` + `SportsSeason` | Válido, semánticamente útil, sin resultado enriquecido | Mantener. Corregir nombres (DQ-06) |
| Equipo | `SportsTeam` con `logo` y `location` | Válido | Añadir `memberOf` con la liga actual y `sport`. Quitar `location` si solo es la ciudad nula |
| Partido | `SportsEvent` con `startDate`, `eventStatus`, `competitor` | Válido. Sin `location` en ningún partido (sede nula) | Añadir `homeTeam`, `awayTeam`, `url` y `superEvent` (la temporada). No inventar `location` |
| Jugador | `Person` con `jobTitle` y foto | Válido, pero expone a menores con nombre y foto | Retirar en jugadores no indexables. En el resto, sin `image` hasta la decisión legal |
| Navegación | Ninguno | | `BreadcrumbList` (Competiciones › OK Liga › Partido) cuando exista la miga visible. Útil semánticamente, el resultado enriquecido de migas en móvil ya no se muestra |

Lo que no hay que esperar: Google no ofrece resultados enriquecidos de marcadores a partir de schema.org. Los marcadores de su SERP vienen de proveedores con licencia. El marcado sirve para entender entidades, no para conseguir una ficha de resultado. Tampoco conviene marcar un partido en directo con su marcador en JSON-LD (no hay propiedad estándar y quedaría desactualizado).

Validación y sincronización: los builders ya son funciones puras en `lib/seo.ts` (los de partido, equipo y jugador están en línea en las páginas: moverlos allí). Tests que validan el JSON contra un esquema mínimo por tipo y que comprueban que cada nombre y fecha del JSON-LD aparece en el texto visible. Revisión mensual de una URL por tipo en la Prueba de resultados enriquecidos.

---

## 12. Google Search Console: procedimiento

No he consultado la cuenta. Esto es lo que necesito y cómo leerlo.

### 12.1 Exportaciones que necesito
| # | Informe | Configuración | Columnas | Para qué |
|---|---|---|---|---|
| 1 | Rendimiento → Resultados de búsqueda | Últimos 3 meses (desde el 11/06), tipo web, pestaña Páginas | Página, clics, impresiones, CTR, posición | Ver qué tipos de página reciben tráfico antes de tocar nada |
| 2 | Igual | Pestaña Consultas | Consulta, clics, impresiones, CTR, posición | Demanda real: marca, competición, equipo, jugador, partido |
| 3 | Igual | Pestañas Países y Dispositivos | Todas | Decidir idiomas (SEO-14) y prioridad móvil |
| 4 | Igual | Comparar 28 días frente a los 28 anteriores | | Línea base |
| 5 | Indexación → Páginas | Exportar el gráfico y cada motivo de "no indexada" con sus URLs de ejemplo | Motivo, URL, último rastreo | Ver cuánto hay de "Rastreada/Descubierta, actualmente sin indexar" por tipo |
| 6 | Sitemaps | Una fila por sección | Estado, URLs descubiertas, última lectura | Comprobar que lee las cinco secciones |
| 7 | Ajustes → Estadísticas de rastreo | Últimos 90 días | Por respuesta, por tipo de archivo, por propósito, estado del host | 307, 5xx, tiempo de respuesta |
| 8 | Enlaces | Páginas más enlazadas externamente | | Decidir redirecciones de URLs antiguas |
| 9 | Inspección de URL | Una de cada tipo y de cada idioma (10 URLs) | Canonical declarada y elegida por Google, HTML renderizado | Confirmar SEO-02 y SEO-14 |
| 10 | Experiencia → Core Web Vitals | Móvil y ordenador | | Sustituir el laboratorio de SEO-12 |

### 12.2 Cómo leerlo sin sacar conclusiones falsas
- Agrupar siempre por tipo de página con expresiones regulares (`/competitions/`, `/teams/`, `/players/`, `/matches/`) y por idioma (`^/es/`…).
- "Descubierta, actualmente sin indexar" a escala suele ser presupuesto de rastreo o calidad percibida del sitio, no un error técnico. "Rastreada, actualmente sin indexar" es casi siempre valor insuficiente de esa página. "Duplicada, Google ha elegido otra canónica" en idiomas indica SEO-14. Ninguna de las tres es una penalización.
- Una URL no indexada no es una penalización. Solo hay penalización si aparece en Seguridad y acciones manuales.
- Falta de demanda: páginas indexadas con 0 impresiones en 8 semanas. Contenido insuficiente: rastreadas y no indexadas. Problema técnico: 5xx, 307 y canonical no respetada. Decisión algorítmica: caídas de impresiones de todo el sitio a la vez en fechas de actualizaciones de Google.
- Separar páginas nuevas (alta de la temporada 2026/27), históricas (partidos de 2025/26) y actualizadas (directos).

### 12.3 Rutina
Semanal (15 min): rendimiento por tipo, nuevos motivos de no indexación, errores de servidor en estadísticas de rastreo. Mensual: inspección de 10 URLs, revisión de sitemaps, Core Web Vitals, acciones manuales.

---

## 13. Riesgos de políticas, penalizaciones y legales

| Riesgo | Tipo | Nivel hoy | Evidencia | Medida preventiva |
|---|---|---|---|---|
| Contenido escalado de poco valor | Algorítmico (sistema de contenido útil, política de abuso de contenido escalado) | **Alto** | 55 % del sitemap son fichas de jugador de ~85 palabras, ×5 idiomas | Matriz §6, sitemap filtrado |
| Páginas generadas sin demanda | Algorítmico | Alto | 457 partidos a más de 90 días, 62 equipos vacíos | Ídem |
| Contenido duplicado | Indexación | Medio | 5 idiomas casi iguales, títulos repetidos, entidades duplicadas | DQ-03, §9, seguimiento por idioma |
| Contenido copiado de la fuente | Algorítmico y legal | Medio | Los datos son los de la FEP y World Skate sin valor añadido en muchas fichas | Añadir lo que la fuente no da: directo, push, histórico, estadísticas calculadas, comparativas |
| Datos incorrectos o desactualizados | Calidad y confianza | Medio | Nombres mal partidos, duplicados, "0-0" posible en directo sin marcador | §5.4 |
| Descripciones de IA sin aportación | Algorítmico | Bajo | No se usan hoy | No introducirlas. Todo texto generado sale de datos |
| Redirecciones engañosas | Acción manual | Bajo | Ninguna. Las 307 de idioma son legítimas | Mantener |
| JSON-LD que no coincide con lo visible | Acción manual de datos estructurados | Bajo | No detectado | Test de coherencia §11 |
| Licencia y condiciones de las fuentes | **Legal o contractual** | Por verificar | Fuentes: `hockeypatines.fep.es` (RFEP, plataforma sidgad), `wse.sidgad.com` y `rinkhockey.worldskate.org` (World Skate). El scraper se identifica como navegador y las imágenes (escudos y fotos de jugadores) se descargan con un `Referer` de la FEP para sortear el bloqueo de hotlink (`player-photo.ts`, `team-logo.ts`) | Revisar aviso legal y condiciones de uso de cada portal, si permiten reutilización y con qué atribución, derechos de imagen de fotos y escudos, y si sidgad tiene condiciones propias. No asumo que esté permitido ni prohibido |
| Datos personales de jugadores y menores | **Legal (RGPD, LOPDGDD)** | **Alto** | Nombre completo, foto, equipo e historial, indexados y con `Person` en JSON-LD. Hay categorías sub-19 y ligas con menores, y no se conoce la edad de nadie | Decisión legal antes de cualquier otra acción sobre jugadores. Mientras, no indexar categorías de formación ni mostrar fotos sin base legal clara |
| Aviso legal | Legal (LSSI, el sitio lleva AdSense) | Por verificar | No hay aviso legal visible | Página de aviso legal y "Sobre" |

Procedimiento si Search Console notifica algo: (1) leer el aviso completo y las URLs de ejemplo, (2) clasificar en acción manual, problema de seguridad, problema de indexación o de mejoras, (3) para acciones manuales, corregir en todas las URLs del patrón, no solo en los ejemplos, documentar el cambio y pedir revisión una sola vez con explicación concreta, (4) para indexación, reproducir con Inspección de URL antes de tocar nada, (5) registrar el incidente en `docs/` con fecha, causa y corrección.

---

## 14. Plan de implementación priorizado

Responsables: **P** = producto (Ángel), **T** = técnico. Esfuerzo: S ≤ 4 h, M 4-16 h, L > 16 h.

### Estado de ejecución (actualizado 18/10/2026)

| Tarea | Estado | Commit |
|---|---|---|
| F0-1 | Hecho (§1b) | f8aa3a2 |
| F0-3 rastreo reproducible | Hecho: `apps/web/scripts/seo-crawl.ts` + tests. Uso en «Rastreo reproducible» (debajo) | 42bfcf4 |
| F1-0 metadata en el `<head>` para rastreadores | Hecho y desplegado (verificado en frío con el UA de Googlebot smartphone) | da36688 |
| F1-1 enlaces internos con idioma + guardia de CI | Hecho, pendiente de desplegar | 72bd8b1, e370834, 0c3409a |
| F1-8 sitemap 503 si falla la API + alerta de caída | Hecho: 503 si la API falla y aviso a Sentry si el total cae más del 20 % (migración 076) | a93747e, 66bde50 |
| F1-9 `?season=` inválido ya no da 500 | Hecho, pendiente de desplegar | 884fb7b |
| F1-10 metadata de error sin heredar la home | Hecho, pendiente de desplegar | 47d3391 |
| F0-2 / F1-2 jugadores menores | Decidido (17/10): se publican nombre y foto porque las fuentes los exponen. Retirada a petición del interesado | — |
| F1-3 / F1-4 elegibilidad y sitemap filtrado | Hecho, pendiente de desplegar. Jugadores de competiciones `top_tier` (migración 074), equipos con partidos, partidos de -60/+14 días | 84f8e4c |
| F1-7 bajas y fusiones con 308 | Hecho, pendiente de desplegar (migración 073). Baja sin sustituto = 404, no 410 | 5d48dc3 |
| F1-5 `noindex` de lo no elegible | Pendiente: 2 semanas después de desplegar F1-4, revisando antes las URLs con tráfico | — |
| F1-6 ocultar por calidad sin desindexar | Hecho, pendiente de desplegar (migración 075). Desviación de §5.3: en vez de servir la última versión con aviso, la ficha responde 5xx las primeras 72 h y 404 después (el producto sigue sin mostrar datos en revisión). Next responde 500, no 503 | 16574ea |
| F1-11 | Pendiente: limpieza de equipos duplicados, necesita revisión manual | — |
| F3-1 escudos en las OG | Hecho: `?format=png` en `/teams/:id/logo`; las OG de partido y equipo lo piden y usan iniciales si no hay escudo | 40bddea |
| F2-5 quitar `changefreq` y `priority` | Hecho: el sitemap ya no los emite | 4a926c0 |
| F2-4 UUID en mayúsculas | Hecho: el middleware responde 301 a la ruta en minúsculas | 5131799 |
| F2-1 `updated_at` estable (lastmod real) | Hecho (migración 077): un UPDATE que solo mueve `updated_at`/`scraped_at` conserva el timestamp; un cambio visible lo mueve. Test de integración contra Postgres real | 5b415d9 |
| F3-3 titles y descriptions | Hecho en títulos de partido, competición, equipo y jugador (fecha/contexto, marcador solo terminado). Las descripciones con datos concretos esperan F3-2 | 4c6d593, bd57851 |
| F3-7 description y `og:url` propios | Hecho: listado, búsqueda y privacidad | 0d7ed4d |
| F2-3 secciones de sitemap por estado | Hecho: `matches-recent` (jugados o en directo, -60 días) y `matches-upcoming` (+14 días) | 1581819 |
| F5-6 migas visibles + `BreadcrumbList` | Hecho: competición, equipo, partido y jugador; los enlaces conservan el idioma | c458f17 |
| F5-4 enlazado entre entidades | Parcial: las migas enlazan cada ficha con su competición; faltan rivales y partido anterior entre ambos | c458f17 |
| i18n de datos (rondas) | Parcial: Histórico, fase final, cuartos/semis/final y puestos N-M traducidos por clave; faltan `match_events.detail` y nombres propios en `jsonb` | b767c56 |
| F3-5 caché y locale de las OG | Hecho: `s-maxage` por tipo y textos/fecha por idioma | 189db27 |
| F3-6 JSON-LD | Hecho: partido con `url`/`homeTeam`/`awayTeam`; equipo con `memberOf`/`sport`; builders puros con tests | bd57851 |
| F6 control SEO programado | Hecho: `seo-check` diario en GitHub Actions (sitemap, canonical y OG) | 2759d38 |
| F2-6 quitar `/sitemap.xml` de Search Console | Hecho (18/10): eliminado el sitemap antiguo que devolvía 404 | — |
| F2-7 redirigir los partidos con tráfico que hoy son 404 | Parcial (18/10). Recuperadas: `d87e7dfc` → `db7f3b3b` (Chile–Angola 12/10; 9 clics y 26 impresiones, consulta «chile vs angola») y `df95ecd9` → `3369141a` (Sudáfrica–Australia 13/10; sintético en el backup del 11/10). El resto de 404 con clics (`c4e78c74`, `a192b8cd`) no tiene consultas ni rastro en BD/backups: se quedan en 404 | — |

Tras desplegar F1-1: en Search Console, pedir la validación de "Duplicada: el usuario no ha indicado ninguna versión canónica" y revisar en 2-4 semanas el porcentaje de redirecciones en Estadísticas de rastreo.

### F1-5 · Revisión previa de URLs con clics (18/10/2026)

Del informe de Páginas de Search Console y el sitemap actual, estas URLs con clics **no** están en el sitemap y devuelven 200. No aplicarles `noindex`:

- `/players/f2d5ca7a-…` (2 clics), `/players/f78b4553-…`, `/players/32b153d1-…`, `/players/0cf66dae-…` y `/players/bff99cf3-…` (1 cada una): jugadores fuera de `top_tier`.
- `/matches/fb634853-…` (1 clic): partido fuera de la ventana -60/+14. §6 indica no marcarlo `noindex`, solo sacarlo del sitemap.

Las URLs de competición por id de temporada (`0ffb4a72`, `c0aa5f5f`, `c9f90718`) responden 307/308 a la competición: no son candidatas. El resto de URLs con clics ya está en el sitemap o es un 404/308.

### Rastreo reproducible (F0-3)

`apps/web/scripts/seo-crawl.ts` materializa el rastreo de esta auditoría. Pide la muestra con el UA de Googlebot para smartphone y guarda un JSON con los campos de §4 (estado, canonical/title en `<head>`, hreflang, robots, JSON-LD, enlaces sin idioma, OG y tiempos). No necesita credenciales ni escribe en la base de datos.

```bash
# Muestra de 10 fichas por tipo, repartida entre idiomas.
npm run seo:crawl --workspace=apps/web -- --per-type=10

# Render en frío: comprueba que la metadata sigue en el <head> (F1-0).
npm run seo:crawl --workspace=apps/web -- --per-type=10 --cache-bust

# Compara con la ejecución anterior: solo imprime lo que cambió.
npm run seo:crawl --workspace=apps/web -- --per-type=10 --compare=seo-crawl-anterior.json

# Comprueba una lista suelta (los 404 de Search Console de F2-7).
npm run seo:crawl --workspace=apps/web -- --urls=404s.txt --out=404s.json

# Comprueba también la imagen Open Graph (F3-1 y F3-5).
npm run seo:crawl --workspace=apps/web -- --per-type=10 --og
```

La muestra es determinista: el mismo sitemap produce siempre las mismas URLs, aunque cambie el orden de las secciones. El JSON lleva `meta` (fecha, commit, base, tamaño) y `pages` (una entrada por URL). Sale con código 2 si alguna URL del sitemap responde 4xx/5xx; el JSON se escribe igual porque los 404 también son diagnóstico.

### Fase 0 · Línea base (antes de tocar nada)
| ID | Prio | Tarea | Problema | Solución | Dep. | Esf. | Riesgo regresión | Criterio de aceptación | Medición | Resp. |
|---|---|---|---|---|---|---|---|---|---|---|
| F0-1 | P0 | ~~Exportar Search Console~~ **Hecho el 16/10 (§1b)** | Sin datos reales no se puede priorizar lo que ya está indexado | Consulta de rendimiento, indexación, sitemaps, rastreo, mejoras e inspección de URL | — | S | Nulo | Línea base en §1b y §16 | — | P |
| F0-2 | P0 | Decisión legal sobre jugadores y menores | DQ-05, §13 | Decidir qué se publica, qué se indexa y si se muestran fotos | — | S (decisión) | — | Decisión escrita en `docs/` | — | P |
| F0-3 | P0 | ~~Script de rastreo reproducible~~ **Hecho el 18/10 (`apps/web/scripts/seo-crawl.ts`)** | Sin forma de comparar antes y después | Muestra por tipo e idioma con el UA de Googlebot, campos de §4 y `--compare` | — | M | Nulo | Genera un JSON comparable entre ejecuciones | Diferencias entre ejecuciones | T |

### Fase 1 · Errores críticos de indexación y calidad del dato
| ID | Prio | Tarea | Evidencia | Solución | Dep. | Esf. | Riesgo | Aceptación | Medición | Resp. |
|---|---|---|---|---|---|---|---|---|---|---|
| F1-0 | P0 | Metadata en el `<head>` para rastreadores | SEO-02, §1b | `htmlLimitedBots` (o metadata bloqueante para todos) + validación en Search Console | — | S | Bajo | 50/50 fichas frías con canonical en `<head>` con UA de Googlebot smartphone | Inspección de URL y motivo "Duplicada sin canónica" | T |
| F1-1 | P0 | Enlaces internos con idioma | SEO-01 | `LocaleLink` y sustitución de `href` | — | M | Medio (navegación) | 0 enlaces internos sin prefijo en el HTML de las fichas, test en CI | 307 en Estadísticas de rastreo | T |
| F1-2 | P0 | Ocultar jugadores menores o sin decisión | F0-2, DQ-05 | Según la decisión: `noindex`, fuera del sitemap, sin foto ni `Person` | F0-2 | S-M | Bajo | Ningún jugador de categorías de formación en el sitemap ni indexable | Conteo en sitemap | T |
| F1-3 | P1 | Función única de elegibilidad | SEO-09, §6 | `pageEligibility()` usada por página y por `/meta/sitemap` | — | M | Medio | Tests por tipo con los casos de §8.3 | URLs por sección en el sitemap | T |
| F1-4 | P1 | Aplicar la matriz al sitemap (sin `noindex` todavía) | §6 | Filtrar equipos vacíos, jugadores por umbral, partidos por ventana | F1-3, F0-1 | S | Bajo (no desindexa) | Sitemap ~4.000-5.000 URLs, todas 200 e indexables | Informe de sitemaps | T |
| F1-5 | P1 | `noindex, follow` en lo no elegible | §6 | `robots` en `generateMetadata` desde la elegibilidad | F1-4 + 2 semanas de observación + revisión de URLs con tráfico | S | Medio | Ninguna URL con clics en F0-1 queda en `noindex` sin revisión manual | Indexadas por tipo | T + P |
| F1-6 | P1 | Ocultar por calidad sin desindexar | DQ-01 | Política §5.3: revisión corta = 200 con última versión, larga = `noindex` | — | M | Medio | Marcar `en_revision` una temporada de prueba no produce 404 | — | T |
| F1-7 | P1 | Tabla `entity_redirects` y 301/410 | DQ-02 | Migración + escritura desde scripts de fusión y limpieza + consulta antes del 404 | — | M | Medio | Fusionar dos equipos de prueba deja 301 de uno a otro | 404 en Search Console | T |
| F1-8 | P1 | Sitemap que no se degrada | SEO-07 | 503 ante fallo de API y alerta por caída > 20 % | — | S | Bajo | Con la API parada, índice y secciones dan 503 | Alerta Sentry | T |
| F1-9 | P1 | 400 de la API no es 500 | SEO-03 | Validar `season` en la web | — | S | Bajo | `?season=zzz` → 200 | 5xx en rastreo | T |
| F1-10 | P1 | Metadata de error no hereda la home | SEO-06 | `noindex` en el `catch` | — | S | Bajo | Con la API caída, ninguna ficha devuelve 200 con título de home | — | T |
| F1-11 | P1 | Limpieza de equipos duplicados y vacíos | DQ-03 | Revisar los 29 grupos y los 62 vacíos con la cola de resolución, fusionar con 301 | F1-7 | M | Medio | Grupos duplicados de clubes = 0. Vacíos justificados o eliminados | Integrity-check | P + T |

### Fase 2 · Arquitectura, canonical y sitemaps
| ID | Prio | Tarea | Evidencia | Solución | Dep. | Esf. | Riesgo | Aceptación | Medición | Resp. |
|---|---|---|---|---|---|---|---|---|---|---|
| F2-1 | P1 | `lastmod` real | SEO-08 | `updated_at` solo con cambios, o `lastmod` calculado | — | M | Bajo | Dos pasadas sin cambios no mueven `lastmod` | Distribución de `lastmod` | T |
| F2-2 | — | (Adelantada a F1-0) | | | | | | | | |
| F2-6 | P3 | Quitar `/sitemap.xml` de Search Console | §1b | Eliminar el sitemap antiguo que da 404 | — | S | Nulo | Solo queda el índice | Informe de sitemaps | P |
| F2-7 | P2 | Redirigir los partidos con tráfico que hoy son 404 | §1b, DQ-02 | Identificar a qué partido actual corresponde cada uno (si existe) y 301 vía `entity_redirects` | F1-7 | S | Bajo | Las 9 URLs de §1b responden 301 o 410 | Informe de páginas 404 | T |
| F2-3 | P2 | Secciones de sitemap por estado de partido | §7 | `matches-recent`, `matches-upcoming` | F1-3 | S | Bajo | Secciones visibles en Search Console | Informe de sitemaps | T |
| F2-4 | P3 | UUID en minúsculas | SEO-04 | 301 en middleware | — | S | Bajo | Mayúsculas → 301 | — | T |
| F2-5 | P3 | Quitar `changefreq` y `priority` | §7 | — | — | S | Nulo | — | — | T |

### Fase 3 · Titles, descriptions, OG y datos estructurados
| ID | Prio | Tarea | Evidencia | Solución | Dep. | Esf. | Riesgo | Aceptación | Medición | Resp. |
|---|---|---|---|---|---|---|---|---|---|---|
| F3-1 | P1 | Escudos en la OG | SEO-10 | PNG local o iniciales | — | S | Bajo | OG de partido con escudos visibles en 10 partidos | Revisión en el depurador de Meta | T |
| F3-2 | P1 | Nombre de presentación curado | DQ-06 | `display_name` + reglas de siglas + edición en admin | — | M | Medio (afecta a toda la UI) | 0 títulos en mayúsculas, siglas correctas en una muestra de 50 | Script F0-3 | T + P |
| F3-3 | P1 | Titles y descriptions según §9 | §9 | Builders puros en `lib/seo.ts` con tests | F3-2 | M | Medio | 0 títulos duplicados en el sitemap, ningún "en directo" fuera de directo | Script F0-3, CTR en Search Console | T |
| F3-4 | P1 | Desambiguar selecciones | DQ-03 | Género y categoría en el nombre visible | F3-2 | S | Bajo | 0 títulos repetidos entre selecciones | — | T |
| F3-5 | P2 | Caché, velocidad y locale de las OG | SEO-11 | `s-maxage`, textos por idioma, fallback 302 | F3-1 | S | Bajo | OG < 1 s en caché, en el idioma de la URL | Tiempo de respuesta | T |
| F3-6 | P2 | JSON-LD según §11 | §11 | Builders en `lib/seo.ts` + tests de coherencia | F1-2 | M | Bajo | Prueba de resultados enriquecidos sin errores por tipo | — | T |
| F3-7 | P2 | Descripción y `og:url` propios en listado, búsqueda y privacidad | SEO-05 | — | — | S | Nulo | — | — | T |

### Fase 4 · SEO programático y contenido útil
| ID | Prio | Tarea | Solución | Dep. | Esf. | Riesgo | Aceptación | Medición | Resp. |
|---|---|---|---|---|---|---|---|---|---|
| F4-1 | P1 | Ficha de partido próximo con datos reales | Posiciones, forma, enfrentamientos previos (§8.1) | F3-3 | M | Bajo | Ningún bloque vacío, test de coherencia con la clasificación | Impresiones de `/matches/` | T |
| F4-2 | P2 | Resumen de estado de competición | Bloque §8.1.1 | F3-2 | M | Bajo | El líder del resumen = primero de la tabla (test) | Impresiones y CTR de `/competitions/` | T |
| F4-3 | P2 | Ficha de equipo con posición, racha y próximo | §8.1 | — | M | Bajo | — | Impresiones de `/teams/` | T |
| F4-4 | P2 | Atribución de fuente, "Sobre", contacto y aviso legal | SEO-13 | — | S | Nulo | Visible en todas las fichas | — | P |
| F4-5 | P3 | Temporadas pasadas indexables | Ruta propia para temporadas terminadas y verificadas | Decisión sobre histórico | L | Medio | — | — | T + P |
| F4-6 | P3 | Página de club | Agrupa equipos del club, cuando el modelo de clubes esté completo | Fase 0 de clubes | L | Medio | — | — | T + P |

### Fase 5 · Rendimiento, enlazado y experiencia
| ID | Prio | Tarea | Solución | Dep. | Esf. | Riesgo | Aceptación | Medición | Resp. |
|---|---|---|---|---|---|---|---|---|---|
| F5-1 | P2 | Medir CWV reales | Informe de Search Console o CrUX | F0-1 | S | Nulo | Línea base guardada | — | T |
| F5-2 | P2 | Reducir TBT | Analizar el chunk principal, diferir AdSense | F5-1 | M-L | Medio | TBT laboratorio < 600 ms en home | INP de campo | T |
| F5-3 | P2 | CLS de la home | Reservar altura de la tarjeta | — | S | Bajo | CLS < 0,1 | — | T |
| F5-4 | P2 | Enlazado entre entidades | Equipo → rivales y competición, partido → partido anterior entre ambos, competición → temporada anterior | F1-1 | M | Bajo | Ningún equipo indexable sin enlaces entrantes | Páginas huérfanas (control §15) | T |
| F5-5 | P3 | Rendimiento de `/players/:id` | Endpoint de ~1,3 s y 5xx con 4 peticiones concurrentes | — | M | Bajo | p95 < 400 ms | Sentry | T |
| F5-6 | P3 | Migas de pan visibles + `BreadcrumbList` | — | — | S | Bajo | — | — | T |

### Fase 6 · Medición, automatización y mantenimiento
Los controles de §15, la rutina de §12.3 y una revisión trimestral de la matriz de indexación con datos de Search Console.

### Resumen por naturaleza
- **Quick wins (≤ 1 día cada uno, bajo riesgo):** F1-0, F1-8, F1-9, F1-10, F2-2, F2-4, F2-5, F3-1, F3-7, F5-3.
- **Cambios estructurales:** F1-1, F1-3 a F1-7, F1-11, F2-1, F3-2, F3-3, F4-x.
- **Requieren Search Console antes:** F1-5 (`noindex`), cualquier decisión de idiomas (SEO-14), cambio de URLs (§7), F5-2.

---

## 15. Observabilidad y prevención de regresiones

| Control | Dónde | Cómo |
|---|---|---|
| Titles y descriptions duplicados | Programado (diario) | Script F0-3 sobre todas las URLs elegibles del sitemap en `es`, alerta si hay duplicados nuevos |
| Canonical ausente o incoherente | CI + programado | Test de `generateMetadata` por tipo. En producción, canonical = URL pedida sin parámetros y en `<head>` |
| URLs indexables sin contenido suficiente | CI | Tests de `pageEligibility()` con los casos de §8.3 |
| 200 que deberían ser 404 | CI + programado | Ids inexistentes por tipo → 404. Ids de `entity_redirects` → 301/410 |
| Sitemap con URLs no canónicas, redirecciones o errores | Programado (diario) | Muestra de 200 URLs del sitemap: todas 200, auto-canónicas, sin `noindex` |
| Imágenes OG que no responden | Programado | Muestra de 20 OG: 200, `image/png`, < 2 s, escudo no uniforme en partidos |
| Errores en datos estructurados | CI | Validación de esquema mínimo por tipo y coherencia con el texto visible |
| Páginas huérfanas | Programado (semanal) | Toda URL del sitemap debe aparecer enlazada desde al menos otra URL del sitemap |
| Descenso anómalo de URLs publicadas | Generación del sitemap | Comparación con la anterior, bloqueo y alerta si cae > 20 % (F1-8) |
| Datos deportivos contradictorios | `integrity-check` diario | Ya cubre estados y marcadores. Añadir resumen frente a clasificación y nombres duplicados |
| Cambios masivos de URLs por un scraping | ETL | Cualquier script que borre o fusione entidades escribe en `entity_redirects` y falla si no lo hace (test) |
| Fallos de generación de metadatos | Sentry | Capturar el `catch` de `generateMetadata` como evento con el tipo de página |
| Enlaces internos sin idioma | CI | Test de F1-1 |
| `lastmod` sin cambios reales | Programado | Dos generaciones sin cambios en la fuente no deben diferir |
| Indexación, rendimiento, acciones manuales | Search Console | Rutina §12.3 |

---

## 16. Plan de medición y línea base

| Métrica | Fuente | Línea base | Objetivo a 12 semanas |
|---|---|---|---|
| Canónica declarada visible para Google | Inspección de URL | Ninguna en las fichas inspeccionadas | La propia URL en el 100 % |
| URLs en sitemap | Este informe | 15.115 | 4.000-5.000, todas elegibles |
| URLs indexadas por tipo e idioma | Search Console | 2.084 indexadas. En la muestra de 1.000: 32 % sin idioma, 9 % `www`, `es` 9 % | Ratio indexadas/enviadas > 80 % en competiciones, partidos jugados y equipos |
| Clics e impresiones por tipo | Search Console | 59 clics y 636 impresiones (10/06-14/10). Competiciones 41/390, partidos 13/97, jugadores 6/108, equipos 1/25 | Crecimiento en competiciones y partidos |
| CTR medio de fichas de partido | Search Console | 13,4 % (13/97), muestra muy pequeña | Mejora tras F3-3 |
| Respuestas 307 y 5xx en rastreo | Estadísticas de rastreo | 51 % redirecciones temporales, 5xx < 1 % | 307 internas ≈ 0, 5xx < 0,1 % |
| Enlaces internos sin idioma | Script | 100 % | 0 % |
| Títulos duplicados en el sitemap | Script | 77 partidos + selecciones y clubes duplicados | 0 |
| Equipos vacíos en sitemap | API | 62 | 0 |
| `lastmod` movidos sin cambios | Sitemap | 98 % de partidos en la última hora | < 5 % |
| OG de partido con escudos | Revisión | 0 % | 100 % con escudo o iniciales |
| LCP / TBT laboratorio home | Lighthouse | 5,2 s / 2,45 s | < 3 s / < 600 ms |
| CWV de campo | Search Console | Sin datos (tráfico insuficiente) | LCP < 2,5 s, INP < 200 ms, CLS < 0,1 |

---

## 17. Decisiones pendientes y datos que necesito

Decisiones de producto (tuyas):
1. **Jugadores menores y fotos**: qué se publica, qué se indexa, con qué base legal. Bloquea F1-2 y cualquier trabajo en fichas de jugador.
2. **Umbral de indexación de jugadores**: propongo absolutos con 5 o más partidos. ¿Hay algún segmento con demanda que conozcas (por ejemplo, internacionales de la selección)?
3. **Idiomas**: mantener los cinco hasta tener datos, o retirar ya alguno de sitemap y hreflang. Mi recomendación es esperar 8 semanas.
4. **Histórico**: si se re-importa, las temporadas pasadas pasan a ser el contenido con más valor permanente (F4-5). Si no, se queda como está.
5. **URLs con slug**: decidir después de la Fase 1, no antes.
6. **Ventana de partidos próximos en el sitemap**: propongo 14 días.

Datos que necesito:
1. Search Console ya está consultado (§1b). Quedan dos cosas: saber quién inició la validación de "Duplicada sin canónica" y, dentro de 4 semanas, repetir la extracción para medir el efecto de F1-0 y F1-1.
2. Confirmación de qué competiciones tienen categorías de formación o jugadores menores.
3. Si hay acuerdo, permiso o condiciones conocidas con la RFEP, World Skate o sidgad sobre la reutilización de datos e imágenes.
4. Si alguna URL anterior al reset del 16/06 tenía enlaces externos que te importen.

---

## 18. Recomendación final

**Qué solucionar primero:** la metadata en el `<head>` para rastreadores (F1-0), que es un cambio de configuración y hoy es lo que más daño hace. En paralelo, la decisión sobre jugadores y menores (F0-2). Después, en este orden, enlaces internos con idioma (F1-1), la función única de elegibilidad con el sitemap filtrado (F1-3 y F1-4), los quick wins técnicos (sitemap que no se degrada, 500 por parámetro, metadata de error) y los escudos de la OG (F3-1), que es lo que más se ve al compartir.

**Qué no tocar todavía:** la estructura de URLs (slugs), los idiomas publicados, el `noindex` masivo (primero sitemap, luego observar, luego `noindex` con revisión de las URLs que ya tengan tráfico) y la creación de páginas nuevas (clubes, temporadas, jornadas). Con 59 clics en cuatro meses no hay datos suficientes para tomarlas bien, y cualquiera de ellas es cara de deshacer.

**Riesgos más importantes:** la exposición de datos de menores, que es un riesgo legal antes que SEO. La señal de calidad del sitio entero lastrada por miles de páginas flojas multiplicadas por cinco idiomas. Y la falta de memoria de bajas y fusiones, que hace que cada limpieza de datos se convierta en un puñado de 404 y que el `lastmod` deje de significar nada.

---

### Anexo · Cómo se obtuvieron los datos
- Rastreo: 100 URLs en `es` (home, listado, búsqueda, privacidad, las 19 competiciones y muestras aleatorias de 25 equipos, 25 jugadores y 25 partidos del sitemap, semilla 7) con UA de Googlebot, sin seguir redirecciones, extrayendo código HTTP, `Cache-Control`, title, description, canonical, robots, hreflang, OG, H1, tipos JSON-LD, imágenes sin `alt`, enlaces internos y palabras visibles.
- API: `GET /api/teams/{id}`, `/api/matches/{id}` y `/api/players/{id}` para todas las entidades del sitemap (346 + 988 + 1.667) con 4 peticiones concurrentes.
- Sitemap: descarga de las cinco secciones y del índice.
- Comprobaciones puntuales con `curl`: redirecciones de idioma, códigos de error, mayúsculas, parámetros inválidos, OG por tipo.
- Lighthouse 12, móvil simulado, cuatro URLs, ejecutado desde un contenedor (índice de benchmark ~1.500).
- Todo es reproducible con el script de F0-3 cuando exista.
