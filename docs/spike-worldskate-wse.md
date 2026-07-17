# Spike: integración World Skate Europe (wse.sidgad.com) — Europeo Sub-17

**Fecha:** 17/07/2026 · **Alcance:** solo investigación, sin tocar código de producción.
**Fuente:** https://wse.sidgad.com/league/320 (U17 WSE European Championship Men, 20–25 jul 2026).

## Veredicto

Viable y con **reutilización muy alta**. `wse.sidgad.com` no es una fuente nueva: es la
**misma plataforma SIDGAD** que ya scrapeas para la FEP, servida como otra instancia con
prefijo de portal `worldskate`. La estructura HTML del calendario es casi idéntica a la que
ya parsea `fep-calendar.scraper.ts`. El trabajo real no está en "atacar la fuente" sino en
(1) parametrizar el cliente para soportar un segundo portal/fuente en el mismo proceso, y
(2) modelar un torneo de grupos + eliminatorias (hoy el modelo está pensado para liga).

Esfuerzo estimado del build posterior: **bajo-medio**. Confirmado con una edición ya jugada
(2024/25, idc=251): las eliminatorias **no necesitan parser nuevo** — se renderizan como filas
estándar y el parser FEP ya las capta. El grueso queda en (1) parametrizar el cliente y (2) el
mapeo de fases a `rounds`.

> Actualizado 17/07/2026 con el payload de la edición 2024/25 (ver secciones marcadas ⬆).

## Arquitectura de la fuente

Mismo backend PHP que la FEP, solo cambia el prefijo:

| FEP (actual) | World Skate | Función |
|---|---|---|
| `rfep_ls_1.php` | `worldskate_ls_1.php` | Listado / warm-up de sesión |
| `rfep_cal_idc_{idc}_1.php` | `worldskate_cal_idc_320_1.php` | Calendario + clasificación |
| `rfep_mc_1.php` | `worldskate_mc_1.php` | Match config (club_id vs team_id) |
| `competicion_header_creator.php` | igual | Cabecera de competición |

- **Base URL:** `https://www.server2.sidgad.es/worldskate/` (confirmado HTTP 200). `wse.sidgad.com`
  es solo el SPA; las XHR van al backend `.es`.
- **Referer:** `https://wse.sidgad.com/`.
- **Llamada calendario:** POST `worldskate_cal_idc_320_1.php` con `{ idc, site_lang }`, igual que FEP.
- Tu `sidgad-client.ts` ya tiene el mecanismo `SIDGAD_PORTAL` (creado para RFEP→FMP).
  `worldskate` sería el tercer caso. Pero ojo: hoy `PORTAL` es una **env global** y varios
  scrapers hardcodean `rfep_` y `BASE_URL='.../rfep'` (ver Riesgos).
- **idc = 320** identifica **solo la fase de grupos**. Cada fase del torneo es un `idc` distinto
  (ver abajo).

## Estructura de datos real (payload de idc=320)

El HTML replica el patrón FEP: `thead.head_jornada` (Jornada 1/2/3), filas
`tr.team_1120 team_1123 team_class` con `gamedate="20260720"`, ids de equipo en las clases CSS,
nombres en `div.nombre_junto_logo`, resultado en `td.web_link_td` (` - ` cuando no se ha jugado),
y `i.game_report[idp]` para el acta. Tres novedades frente a la FEP:

1. **Clasificación embebida en la misma respuesta.** Tras el calendario vienen las tablas
   `GROUP A` y `GROUP B` (`tabla_standard` con PTS/PJ/PG/PE/PP/GF/GC/Gav/Pen). En la FEP la
   clasificación venía de un endpoint `clasif` aparte; aquí sale del mismo HTML → un parser, dos
   entidades.

2. **Equipos = selecciones nacionales.** GERMANY, SPAIN, PORTUGAL… (ids sidgad 1116–1123). Logos
   en `sidgad.com/worldskate/images/logos_clubes/NN.png` (ruta distinta a la FEP). HTML
   multi-idioma con spans `lang_label lang_es/lang_en/lang_it/lang_gl` — hay que elegir un idioma
   (recomiendo `lang_en`, o el nombre plano que ya viene fuera de spans).

3. **Fases apiladas en una sola respuesta ⬆ (confirmado con edición 2024/25).** El `idc` padre
   (251) devuelve **todas las fases del torneo apiladas** en el mismo HTML: cada fase es una
   `table.content_fase_XXX` precedida de `div.div_titulo_fase_idc filter_fase_XXX` con su título
   ("KNOCKOUT STAGE", "5 TO 7", "GROUP PHASE"). Es decir, **un solo scrape del idc padre = torneo
   completo** (grupos + eliminatorias + consolación), cada bloque con su calendario y, si aplica,
   su clasificación. Los sub-idc (253, 254…) son direccionables por separado pero no hace falta.

4. **Las eliminatorias NO usan `playoff_box` ⬆.** El CSS `.playoff_box/.playoff_table` viene
   definido pero **no se usa**: cuartos, semis, final y "small final" se renderizan como **filas
   `tr.team_X team_Y team_class` idénticas a la liga**, con el nombre de la ronda en el
   `thead.head_jornada` (FINAL / SMALL FINAL / SEMIS FINALS / QUARTERSFINALS). Tu parser FEP ya lo
   capta vía `currentRoundName`. **No hay que escribir parser de brackets.** El cuadro visual es
   cosa del frontend.

5. **Campos extra útiles ⬆.** Cada partido jugado trae: resultado en `web_link_td` ("2 - 2"),
   `i.game_report[idp][idc][idm]` para el acta (idm nuevo respecto a FEP), `a.link_ficha_partido`
   (`fichapartido_{idp}`), y **enlace de vídeo** `europe.worldskate.tv/video/?videoId=e-XXXXX`. En
   eliminatoria hay **penaltis** (la final 2024/25 fue 2-2 → decidida por penaltis); tu migración
   030 (`penalty_shootout_detail`) ya cubre esto — el detalle vendrá en el acta, no en el marcador.

> Nota: la edición actual (idc=320) empieza 20/07/2026, ahora a 0 y sin actas. La 2024/25 (idc=251)
> ya está jugada y sirve de referencia para el parser de resultados/actas/vídeo.

## Encaje en el modelo actual

Encaja razonablemente sin rediseño profundo:

- **competitions:** una fila. `scope=international`, `organizer=WSE`, `age_category=base`. Tu
  backfill de la migración 017 ya mapea "EUROPEO"/"SUB-17"/"WORLD" a international+base, así que la
  taxonomía sale sola.
- **data_sources:** fila nueva `scraper_key='worldskate_hockey'` con su **propio UUID**. **No
  reutilizar `FEP_SOURCE_ID`** (rompería la separación de fuentes y el gotcha del placeholder).
- **rounds:** dos niveles. Fase (content_fase / filter_fase → título "GROUP PHASE", "KNOCKOUT
  STAGE", "5 TO 7") + ronda interna (thead.head_jornada → "Jornada 1", "FINAL", "SEMIS FINALS"…).
  Mapear grupos → `round_type='regular'`, eliminatorias → `playoff`. El `name` de la ronda
  ("Cuartos"/"Semifinal"/"Final"/"5º–7º") basta para reconstruir el cuadro en frontend; no hace
  falta un tipo `bracket` nuevo. Las clasificaciones de grupo (una o dos tablas GROUP A/B por fase)
  se cuelgan de la ronda de grupo. Ojo: los nombres de ronda vienen **en inglés y sin normalizar**
  ("QUARTERSFINALS", "SEMIS FINALS") — normalízalos en el ETL.
- **equipos:** selecciones nacionales con `team_id` sidgad. Aplica el **gotcha club_id vs team_id**
  del endpoint `mc` → asegurar `alt_source_refs` para no omitir partidos tras el seed.

## Arquitectura recomendada a largo plazo (decisión 17/07/2026)

**Contexto de la decisión:** a futuro convivirán muchas competiciones y fuentes (FEP nacional,
autonómicas RFEP/FMP/FAP…, World Skate Europe, y más adelante otros proveedores). La pregunta
"¿FEP y WSE en el mismo proceso?" se responde con un **sí, y por diseño**: un único proceso que
itera sobre un registro de fuentes, no un scraper por federación con env global. La
parametrización del cliente deja de ser opcional; es la base del modelo.

**Principio:** mover toda la configuración específica de fuente de código/env a **datos**. El
scraper se vuelve genérico y dirigido por el registro `data_sources` + un vínculo
competición→fuente. Nada de `FEP_SOURCE_ID` global ni `PORTAL` en env.

### 1. `data_sources` como registro de fuentes (una fila por portal)

Extender la tabla con la config que hoy está hardcodeada o en env:

| columna | ejemplo FEP | ejemplo WSE |
|---|---|---|
| `scraper_key` | `fep_hockey` | `worldskate_hockey` |
| `provider` | `sidgad` | `sidgad` |
| `base_url` | `https://www.server2.sidgad.es/rfep` | `https://www.server2.sidgad.es/worldskate` |
| `portal_prefix` | `rfep` | `worldskate` |
| `referer` | `https://www.hockeypatines.fep.es/` | `https://wse.sidgad.com/` |
| `logo_base` | (ruta FEP) | `https://www.sidgad.com/worldskate/images/logos_clubes/` |
| `default_timezone` | `Europe/Madrid` | `Europe/Lisbon` |

`source_id` (UUID) sigue siendo el que se estampa en competiciones/equipos/partidos.

### 2. Vínculo competición → fuente (dirige el scraping)

Una tabla ligera `competition_sources` (o columnas en `competitions`) que asocia cada competición
con su fuente y sus **ids externos**: `source_id`, `external_idc` (el idc padre sidgad, p. ej. 320
para 2025/26, 251 para 2024/25), y `timezone` de la **sede** (puede sobreescribir el default de la
fuente: Braga → `Europe/Lisbon`). El scraper de fases se descubre solo desde los bloques
`content_fase_XXX`, así que basta el idc padre.

### 3. Cliente sidgad instanciable (fin del singleton + env global)

`sidgad-client.ts` pasa de **módulo-singleton con env global** a **clase instanciable**
`SidgadClient({ baseUrl, portalPrefix, referer })`, con sus cookies de sesión por instancia. Así
FEP y WSE viven a la vez en el mismo proceso, cada uno con su cliente. El mecanismo `PORTAL`/
`portalPath` actual se conserva, pero configurado por instancia en vez de por `process.env`.

Mantener un `Provider` como interfaz fina (hoy solo existe `sidgad`, pero deja la puerta abierta a
un proveedor no-sidgad futuro sin reescribir el orquestador). No sobre-ingenierizar: una clase
sidgad + interfaz mínima, nada de framework genérico prematuro.

### 4. Parsers genéricos reutilizables

Extraer del scraper FEP dos parsers de proveedor, agnósticos de federación:
`SidgadCalendarParser` (recorre `content_fase_XXX` → fase, `head_jornada` → ronda, filas → partidos,
incluidas eliminatorias; capta resultado, `idp`, `idm`, vídeo) y `SidgadStandingsParser` (tablas
GROUP A/B). Las diferencias por fuente (ruta de logo, idioma, presencia de vídeo) se pasan como
opciones, no como ramas hardcodeadas.

### 5. Orquestador dirigido por datos

Un runner que consulta `data_sources` + competiciones activas, construye el `SidgadClient` y el
parser desde la fila de la fuente, scrapea y entrega crudo al ETL. Añadir una competición futura =
insertar filas (fuente si es nueva + competición con su idc), **sin tocar código**.

### 6. ETL: fases → `rounds` y timezone por sede

Mapear fase→`rounds` (`regular`/`playoff`), **normalizar nombres de ronda** con un diccionario
canónico (EN/IT/ES: "QUARTERSFINALS"→"Cuartos", etc.). Sustituir `madridToUtc` por un
`zonedToUtc(fecha, tz)` genérico que tome la `timezone` de la competición (Braga = `Europe/Lisbon`,
UTC+1 en verano; usar Madrid aquí sería un bug de −1h). Equipos vía `alt_source_refs` con scope de
fuente (ya existe). Guardar el vídeo en una columna nueva `matches.video_url` (nullable).

### Plan de migración incremental (seguro, sin romper OK Liga en prod)

1. **M1** — extender `data_sources` (provider/base_url/portal_prefix/referer/logo_base/timezone) y
   backfillear la fila FEP con sus valores actuales.
2. **M2** — refactor `SidgadClient` a clase instanciable; adaptar los scrapers FEP para construirla
   desde la fila FEP. **Preserva comportamiento**: OK Liga sigue igual (regresión = 0).
3. **M3** — seed: `data_sources` worldskate + competición Europeo Sub-17 (idc 320) + selecciones
   nacionales con `alt_source_refs`.
4. **M4** — generalizar los parsers (fase-aware), manteniendo los tests FEP en verde.
5. **M5** — migración `matches.video_url` + poblarlo desde el parser.
6. **M6** — ETL: normalización de rondas + `zonedToUtc` + carga de la edición 2024/25 como
   validación (datos ya jugados) antes de la 2026 en vivo.

> Coste incremental sobre lo que ya tienes: moderado, y casi todo es refactor de desacoplamiento
> que además **paga deuda** para las autonómicas que ya tenías en mente (RFEP/FMP dejan de necesitar
> env global). El scraping en sí es reutilización directa del parser FEP.

## Riesgos y trabajo real (para el build)

1. **Desacoplamiento del cliente (refactor principal).** Resuelto por diseño en la sección de
   arquitectura: `SidgadClient` instanciable + config en `data_sources`. Es el grueso del esfuerzo,
   pero es refactor de desacoplamiento que además paga deuda para las autonómicas.
2. **Split de fases y mapeo a `rounds`.** El parser debe recorrer los bloques
   `content_fase_XXX` / `filter_fase_XXX` y asignar cada tabla a su fase, y dentro, cada
   `head_jornada` a su ronda. Es lógica nueva pero sencilla (no requiere parser de brackets).
3. **Timezone.** El torneo es en sede europea; revisar la zona de la sede y reusar bien
   `madridToUtc` / la corrección de TZ que ya aplicaste, para no repetir el bug de fechas.
4. **Multi-idioma y rutas de logo** distintas: ajustar el parser (idioma y path de escudos).
5. **Penaltis en eliminatoria.** Marcadores empatados en KO (final 2-2) se resuelven por penaltis;
   el marcador plano no lo refleja. Recuperar el desempate del acta (migración 030).

> El plan de ejecución vive ahora en "Plan de migración incremental" (sección de arquitectura).

## Datos de la edición 2026 (web oficial WSE)

- **Sede:** Braga (Portugal). **Fechas:** 20–25 julio 2026. **Timezone:** `Europe/Lisbon` (UTC+1
  en verano). 8 selecciones masculinas (ESP, POR, ITA, FRA, ENG, SUI, GER, AND).
- idc padre de esta edición: **320** (fase de grupos visible; las eliminatorias aparecerán como
  fases apiladas cuando se generen).

## Decisiones tomadas (17/07/2026)

1. **Arquitectura multi-fuente dirigida por datos** (registro `data_sources` + cliente
   instanciable), no un proceso por federación. FEP y WSE conviven en el mismo orquestador.
2. **Timezone por sede** desde la web oficial: Braga → `Europe/Lisbon`. Sustituir `madridToUtc`.
3. **Cargar enlaces de vídeo** de worldskate.tv como dato del partido (`matches.video_url`).
