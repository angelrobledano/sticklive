# Fases de competición y directo por señal explícita

- **Fecha:** 2026-10-08
- **Estado:** implementado en la rama `feat/fases-y-directo-explicito` (pendiente de revisión y despliegue)
- **Ámbito:** `packages/shared-types` (reglas de dominio), `packages/db` (migración 072 + queries),
  `apps/scraper`, `apps/etl`, `apps/api`, `apps/web`, `apps/mobile`, tests y docs.
- **Origen:** auditoría pedida por producto — «los partidos en directo no funcionan de forma fiable» y
  «las competiciones nuevas no se entienden: no sabemos si es liga, grupos, eliminatoria o final four».
- **Operación:** [runbook-fases-y-directo.md](../../runbook-fases-y-directo.md) (despliegue, re-scrape de
  temporadas heredadas y reparación de datos en producción).

## 1. Diagnóstico

Las dos quejas tenían la misma raíz: **la fuente publica la información de forma explícita y la
plataforma la tiraba, para luego volver a adivinarla en varios sitios con reglas distintas.**

### 1.1 Por qué fallaban los directos

1. **LIVE calculado por la hora en seis sitios**: calendario FEP, calendario World Skate, API
   (`effective-status`), `MatchCard` y `classifyMatch` en la web y la app móvil. Un partido programado
   cuya hora ya había pasado se pintaba "EN DIRECTO" 0-0 durante 5 h aunque no hubiera empezado, se
   hubiera aplazado o la hora estuviera mal publicada. La ficha y `/matches/live` (que mira la BD) no
   coincidían con la lista.
2. **Sin prioridad entre fuentes**: `upsertMatch` hacía `status = EXCLUDED.status` y ganaba el último
   que escribía. El calendario horario, que no sabe nada del directo, podía devolver a `scheduled` un
   partido en juego; un transformer rellenaba `scheduled` por defecto cuando la fuente no decía nada.
3. **World Skate ignoraba la señal explícita**: `worldskate_mc_1.php` marca cada partido como
   `playing` / `final` / `pending` con marcador y periodo, y solo se usaba para sacar el `idp`. Además el
   índice de `idp` (logos + día) confundía categorías: el ITA-COL femenino de los WSG se llevó el `idp` del
   cuarto de final sub-19 COL-ITA (3359).
4. **Zona horaria de Asunción errónea**: el código fijaba UTC-4; Paraguay está en UTC-3 permanente desde
   2024. Todo el Mundial iba 1 h desplazado (y, con el LIVE por reloj, "empezaba" a destiempo).
5. **El final solo se detectaba por indicios**: desaparecer del feed durante N ciclos o el watchdog a las
   5 h. El acta ya lo marca: `#game_period.periodo_fin` = «FINALIZADO».
6. **Partidos que empiezan tarde**: la ventana del directo (`live-window`) y el watchdog medían desde la
   hora PREVISTA; un partido retrasado salía de la ventana o se daba por zombi antes de tiempo.
7. **Feed FEP con inferencias**: un marcador con dígitos sin clase reconocible se leía como `live`, y un
   texto vacío como `scheduled`.

### 1.2 Por qué no se entendía el formato

1. **El "formato" era un único campo por competición** (`competition_sources.external_ids.format`:
   `league` | `bracket` | `final_four`). «Grupos + Final Four» o «liga + playoff + playoff de
   colocación» no se podían representar; `final_four` ocultaba la clasificación de la fase de grupos.
2. **La fuente ya da la estructura y se perdía**: el calendario SIDGAD publica bloques de fase con id y
   título (`content_fase_3483` «PLAY OFF OK LIGA», `content_fase_3482` «PLAY OFF 9 Y 10») y cabeceras de
   ronda con el nº de partido de la serie («2 CUARTOS», «4 FINAL», «PARTIDO 1»). El ETL metía todo el
   playoff de OK Liga en una ronda fija (100, «Playoff por el título»), las copas en rondas con números
   mágicos (listas `PLAYOFF_IDCS_PIPELINE` / `CUP_IDCS`, `cup-rounds.ts`), y World Skate compartía una
   ronda canónica entre fases (74 «Puestos 5.º-8.º»). La Copa del Rey 2025/26 quedó con sus 7 partidos en
   una única ronda «FINAL».
3. **Re-inferencia en siete sitios**: regex sobre el nombre de la competición (`/play[- ]?off/`), orden
   cronológico en la API («la última serie es la final»), `roundNumber > 3` en la web, grafo de avance,
   cadenas de ganadores… Ejemplo real: durante las semis, la regla cronológica etiquetaba la 2.ª
   semifinal como «Final».

Las Bases RFEP 2026/27 confirman el modelo real: OK Liga = liga regular → Play Off por el título
(cuartos al mejor de 3, semis y final al mejor de 5) + Play Off 9.º-10.º; Supercopa = final four;
Copa del Rey = final eight; Plata = grupos Norte/Sur + eliminatoria a doble partido.

## 2. Arquitectura

### 2.1 Modelo

```text
Competition → Season → Phase → (Group) → Round → Match
                         │                  │        └ series_game (nº de partido de la serie)
                         │                  └ jornada (league/groups) o stage (knockout)
                         └ kind: league | groups | knockout · is_placement · ordinal · resolved_by
```

- El **formato no es un campo**: es la secuencia de fases de la temporada. Liga + playoff = `league` →
  `knockout`; grupos + final four = `groups` → `knockout` (semis → final); solo final four = un
  `knockout` que empieza en semis; eliminatoria = un `knockout` desde cuartos.
- `stage` canónico: `round_of_16 | quarters | semis | final | third_place | placement`.
- `is_placement` separa las fases que no deciden el título (9.º-10.º, 5.º-8.º).
- `resolved_by` deja la traza de qué evidencia decidió el tipo de fase.

### 2.2 Orden de evidencia (único, en `planSourceStructure`)

1. **Datos explícitos de la fuente**: cabeceras de ronda («JORNADA 5» → liga; «2 CUARTOS» → cuartos,
   partido 2) → `source_rounds`; título del bloque de fase («GRUPO A», «PLAY OFF 9 Y 10») → `source_title`.
2. **Metadato estructurado**: `competition_sources.external_ids.format` → `declared`.
3. **Regla determinista**: una fase con solo dos equipos es una eliminatoria; con grupos, `groups` →
   `structural_rule`.
4. **Fallback** a liga, marcado `fallback` y con aviso a Sentry (nunca silencioso).

Los parsers reconocen el **vocabulario** de la fuente (es/ca/en/it/pt), no nombres de competiciones.

### 2.3 Estado del partido

Máquina de estados única en `@sports/shared-types`:

- `resolveStatusTransition(prev, observed)`: **una fuente sin información de estado no cambia el
  estado** (`observed` ausente → se conserva). Las correcciones hacia atrás (p. ej. `finished` → `live`
  porque la fuente rectifica) se aceptan solo si las da la fuente y quedan marcadas como `correction`.
- En SQL: `status = COALESCE($nuevo, matches.status)`.
- **LIVE solo con señal explícita**: feed en vivo FEP (`scorer_game_playing`, periodo publicado), match
  center de World Skate (`playing`), acta en juego.
- **Final** por: feed (`final`), acta (`periodo_fin`, con la guarda de que el feed del mismo ciclo no lo
  siga dando en juego), resultado publicado en el calendario, o el respaldo de siempre (desaparición del
  feed, watchdog).
- **Presentación** (`matchDisplayState`): la hora solo distingue, dentro de `scheduled`, «aún no es la
  hora», «pendiente de inicio» (la hora pasó y la fuente no lo da en juego) y «sin resultado» (≥ 5 h).
  Nunca devuelve `live`.

## 3. Cambios por capa

| Capa | Cambio |
|---|---|
| `shared-types` | Reglas de estado (`resolveStatusTransition`, `matchDisplayState`, `isLiveStatus`) y de estructura (`parseRoundLabel`, `parsePhaseTitle`, `resolvePhaseKind`, `planSourceStructure`, `compatRoundNumber`, `compatCompetitionFormat`). Inlined en `src/index.ts` (Metro no resuelve `./x.js` → `.ts`). |
| `db` | Migración 072; `ensurePhase` / `ensurePhaseRound` (idempotentes, adoptan lo heredado), `pruneStaleRounds`; `upsertMatch` con estado opcional y `phase_id` / `series_game`. |
| `scraper` | Parser genérico de la estructura SIDGAD (`core/sidgad-structure.ts`) para FEP, World Skate y FECAPA. World Skate lee el estado del match center e indexa `idp` por logos + día + hora. Zona horaria con `Intl` (cualquier IANA). Calendario FEP sin estado por reloj. Feed FEP sin inferencias (`inferStatus`). Cabecera del acta: `ended`. |
| `etl` | `processCalendar` genérico (fuera listas de idc para la estructura y `cup-rounds.ts`); `apply-structure.ts`; `acta-final.ts`; ventana del directo con 120 min de margen; watchdog desde `COALESCE(started_at, scheduled_at)`. |
| `api` | `lib/season-structure.ts`: `/seasons/:id/overview` y `/teams/:id` exponen `season.phases`, `rounds[].phaseId/stage`, `matches[].phaseId/stage/seriesGame/stageInferred`; los campos legados se calculan desde la fase explícita. DTO de partido sin LIVE por reloj (fuera `effective-status`). |
| `web` | `PlayoffsTab` pinta cada fase eliminatoria según su estructura (series / final four / cuadro); helpers con `stage` primero; Jornadas sin rondas eliminatorias; `MatchCard` muestra «Pendiente» / «Sin resultado» en vez de un directo falso. |
| `mobile` | `isEffectivelyLive` solo por estado; la ventana sin anuncios pasa a `isAdQuietTime`. |

## 4. Migración 072 (aditiva)

- Nuevas: tabla `phases`; `rounds.phase_id`, `rounds.stage`; `matches.phase_id`, `matches.series_game`.
- Identidad de ronda: de `(season_id, number, round_type)` a `UNIQUE NULLS NOT DISTINCT (season_id,
  phase_id, number, round_type)` — para las filas sin fase la unicidad es exactamente la de antes.
  Requiere PostgreSQL ≥ 15 (producción: 16).
- **Backfill** (`backfill_legacy_phases()`, re-ejecutable): cada temporada existente recibe fases
  `legacy` deducidas de lo que ya había (round_type y formato declarado), sin reinterpretar nada. La
  `stage` solo se fija en rondas heredadas con nombre inequívoco **y** número de cruces compatible (la
  «FINAL» de 7 cruces de la Copa del Rey queda sin `stage`).
- No borra filas ni columnas. No toca `matches.updated_at` (trigger desactivado durante el backfill) ni
  dispara `pg_notify` (el trigger del directo solo mira estado/marcador/crono).
- **Adopción**: el primer scrape estructurado de una temporada heredada adopta sus fases y rondas en vez
  de crear otras en paralelo; los partidos conservan su id. Las rondas que quedan vacías y la fuente ya
  no publica se retiran (`pruneStaleRounds`; nunca una ronda con partidos).

## 5. Compatibilidad

- **API**: no se quita ningún campo. `roundNumber` (1/2/3/0), `roundType` y `competitionFormat` se
  calculan desde la fase explícita. Para fases heredadas sin re-scrapear se conserva el comportamiento de
  antes: la deducción cronológica del playoff en una sola ronda sigue, **aislada y marcada**
  (`stageInferred`), y el formato es el declarado.
- **Web**: con `season.phases` (y `fromSource`) usa la estructura; sin ellas (payload antiguo o temporada
  heredada) mantiene la presentación anterior.
- **App**: el cambio del directo llega con la siguiente build.

## 6. Tests

- Dominio (`shared-types`): 16 de estado + 28 de estructura (casos A–F, grupos, colocación, etiquetas
  es/ca/en).
- Scraper: estructura SIDGAD (FEP, World Skate WSG), match center (estados e `idp`), zona horaria, feed
  FEP sin inferencias.
- ETL / BD contra Postgres real: fases y backfill (12), estructura + estado de punta a punta (12+), ventana
  del directo y watchdog con inicio tardío, cadena del directo.
- API: `season-structure` (14), DTO de partido sin reloj; integración de `/seasons/:id/overview` con los
  casos A–F y una temporada heredada → re-scrape (7).
- Web: fases y cuadros (16), tarjeta de partido sin directo por reloj, `classifyMatch`.
- App: `isEffectivelyLive` y `isAdQuietTime`.

## 7. Riesgos y limitaciones conocidas

- **Clasificación no ligada a fase**: `standings` sigue por temporada (y grupo). Se atribuye a la primera
  fase liguilla por el título. Una temporada con dos liguillas consecutivas necesitaría `standings.phase_id`.
- **Eliminatoria a doble partido vs. al mejor de N**: la web lo distingue por la estructura publicada (3.er
  partido de la serie → al mejor de N; dos partidos → ida/vuelta, por goles). Si la fuente no publica el
  3.er partido de una serie al mejor de 3, se pintaría como ida/vuelta hasta que lo publique.
- **Plata Norte/Sur** siguen modeladas como dos competiciones (la RFEP las trata como una con grupos). No
  se cambia aquí: es una decisión de producto con impacto en URLs y favoritos.
- **Datos ya escritos en producción** que requieren re-scrape o reparación puntual (OK Liga 2025/26,
  Copa del Rey 2025/26, WSG femenino ITA-COL): ver el runbook.
- **Ventana de despliegue**: el `etl` antiguo, si coincide con la migración, puede fallar un upsert de
  rondas (la restricción antigua desaparece). Parar el `etl` antes de `up`; ver runbook.
- **App móvil**: hasta que se publique la build nueva, la app instalada sigue pintando LIVE por reloj.
