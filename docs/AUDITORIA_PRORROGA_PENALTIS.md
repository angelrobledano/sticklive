# Auditoría + diseño — Prórroga y tanda de penaltis

*24 de junio de 2026 · evidencias del código actual + solución integral (SDD)*

---

## 0. Resumen ejecutivo

Hoy el producto **no modela prórroga ni penaltis en ningún punto**: ni estado, ni columnas, ni eventos, ni UI, ni notificaciones. El partido se representa solo con `home_score`/`away_score` + un `status` de cinco valores. Consecuencias verificadas:

- **Bug de corrección (alta):** en playoffs, un partido que acaba empatado y se decide por penaltis se atribuye mal al ganador, porque la victoria se calcula comparando marcadores (`score.home > score.away`). Un 3-3 resuelto en penaltis cuenta como victoria del visitante o como "sin ganador".
- **Riesgo de datos (media):** si la fuente marca un partido como "prórroga"/"penaltis", `normalizeStatus` no lo reconoce y lo degrada a `scheduled`.
- **Pérdida de información (media):** el usuario no puede saber *cómo* se ganó (reglamentario/prórroga/penaltis) en ninguna pantalla.

Lo único que **no** se rompe es la **clasificación**: los puntos se *scrapean* de la fuente, no los calculamos, así que prórroga/penaltis ya vienen reflejados ahí.

> Aclaración importante de nomenclatura: el evento `penalty` que ya existe es el **lanzamiento de falta directa/penalti dentro del partido**, no la tanda. La tanda de penaltis no está modelada.

---

## 1–2. Dónde NO se contempla prórroga / penaltis (evidencias)

**Modelo de datos** — `matches` solo tiene `home_score`, `away_score` y un `status` con CHECK cerrado:
`packages/db/migrations/001_initial_schema.sql:186-188` → `home_score INT, away_score INT, status ... CHECK (status IN ('scheduled','live','finished','postponed','cancelled'))`. No hay columnas de prórroga ni penaltis. Migración `027_match_live_clock.sql:14` añade `live_period`/`live_is_halftime`/`live_clock_seconds` (crono en vivo), pero no un estado de prórroga ni de tanda.

**Tipos compartidos** — `packages/shared-types/src/index.ts:7` → `MatchStatus = 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled'`. El SDD pide `OVERTIME` y `PENALTY_SHOOTOUT`: no existen. `EventType` (línea 10) tampoco tiene un evento de inicio de prórroga/penaltis.

**Scraper / ETL** — `apps/etl/src/transformers/match.transformer.ts:9-35`: el `STATUS_MAP` no mapea "prórroga"/"penaltis"; `normalizeStatus` cae a `'scheduled'` por defecto (línea 34). La ficha (`fep-ficha.scraper.ts`) parsea `goal/penalty/blue_card/red_card/foul/direct_foul/period_end` pero **no** detecta tanda de penaltis ni marcador de prórroga.

**API** — `apps/api/src/routes/live.ts` y `match-stream.ts` devuelven `score: { home: home_score, away: away_score }` y un `status` de los cinco valores; no hay campo de prórroga/penaltis ni marcador de tanda.

**Notificaciones** — `apps/etl/src/push-dispatcher.ts`: emite inicio/gol/final/tarjetas/falta; `final` usa `finalAlert(ref)` (`notification-copy.ts:109`) que solo lee el marcador. No hay aviso de inicio de prórroga ni de penaltis, ni copia que distinga el tipo de victoria.

**Front (listados, ficha, resúmenes)** — el marcador se pinta siempre como `score.home`–`score.away` con etiqueta `match_states.final` (p. ej. `MatchCard.tsx:128`, header de `MatchCenterClient.tsx`). No hay variante "FINAL (Prórroga)" / "FINAL (Penaltis)".

---

## 3–6. Inconsistencias, casos límite y bugs (evidencias)

**Bug 1 · Ganador por marcador en series de playoff** — `apps/web/src/lib/playoff.ts:37` → `const homeWon = g.score.home > g.score.away;` y `:39` `if (homeWon === homeIsA) winsA++; else winsB++;`. Un partido 3-3 decidido en penaltis tiene `score.home === score.away` → `homeWon=false` → suma victoria al equipo equivocado. **Atribuye mal quién pasa la eliminatoria.**

**Bug 2 · Resaltado de ganador en la ficha de competición** — `CompetitionClient.tsx:627` → `winner = (g.score.home ?? 0) > (g.score.away ?? 0)`. Un 3-3 por penaltis no resalta a nadie (parece empate). Mismo patrón en `PlayoffBracket.tsx:34-35` (usa `score.home/away` directos).

**Inconsistencia de datos** — `normalizeStatus` degradando "prórroga"→`scheduled` (evidencia arriba) puede dejar un partido en vivo de prórroga mostrándose como "programado".

**Caso límite de marcador** — hoy `home_score`/`away_score` es el marcador **final** (incluida prórroga, si la fuente lo suma). No sabemos si la fuente entrega el reglamentario por separado; sin ese dato no se puede mostrar "3-3 (4-3 prórroga)" ni "3-3 (2-1 pen.)" correctamente. **Dependencia de origen a confirmar** (ver §8).

---

## 7–10. Cambios necesarios por capa (diseño SDD)

### Backend / datos (§8 del SDD)

Migración nueva sobre `matches`, separando reglamentario de prórroga/penaltis sin romper el marcador final actual:

```sql
ALTER TABLE matches
  ADD COLUMN home_goals_reg   INT,      -- marcador al final del tiempo reglamentario
  ADD COLUMN away_goals_reg   INT,
  ADD COLUMN home_pen         INT,      -- goles en la tanda
  ADD COLUMN away_pen         INT,
  ADD COLUMN win_type         TEXT CHECK (win_type IN ('regular','overtime','penalties')),
  ADD COLUMN winner_team_id   UUID REFERENCES teams(id);
-- Ampliar el estado en vivo:
ALTER TABLE matches DROP CONSTRAINT matches_status_check;
ALTER TABLE matches ADD CONSTRAINT matches_status_check
  CHECK (status IN ('scheduled','live','halftime','overtime','penalty_shootout','finished','postponed','cancelled'));
```

`home_score`/`away_score` se mantienen como **marcador mostrado por defecto** (incluye prórroga). Tipos: ampliar `MatchStatus` y añadir `MatchResult` (el del SDD) en `shared-types`. Scraper: mapear "prórroga"/"penaltis" en `STATUS_MAP`, y en la ficha detectar la tanda y rellenar `home_pen`/`away_pen` + `win_type` + `winner_team_id` (un `period_end` con periodo ≥3 o una sección "penaltis" en el acta). **Confirmar primero con `live-probe` qué expone la fuente.**

### Lógica de ganador (corrige bugs 1 y 2)

Sustituir la comparación de marcador por `winner_team_id` cuando exista:

```ts
const winnerId = g.winnerTeamId ?? (g.score.home > g.score.away ? homeId : g.score.away > g.score.home ? awayId : null);
```

Aplicar en `playoff.ts` (cómputo de `winsA/winsB`), `CompetitionClient.tsx` y `PlayoffBracket.tsx`.

### Front (representación, §"Vista de partido" y "Partidos del día")

Un solo helper de presentación reutilizable (p. ej. `lib/match-result.ts`) que, dado el `MatchResult`, devuelve el marcador, la etiqueta y el sufijo:

- Ficha: `4 - 3` · `FINAL (Prórroga)` · "Ganador: Barcelona". Penaltis: `3 - 3` · línea `Penaltis 2 - 1` · `FINAL (Penaltis)`.
- Listado/día y resumen de jornada: sufijo compacto `(PP)` / `(2-1 pen.)`, como pide el SDD.
- En vivo: badge `PRÓRROGA` y, en tanda, `PENALTIS 2-1` (reusa el patrón del badge "Descanso" que añadimos).

Consistencia global: todos los sitios que hoy pintan `score.home–score.away` deben pasar por ese helper (listados, ficha, seguidos, OG image, resúmenes).

### Notificaciones (§ del SDD)

Nuevos eventos en `push-dispatcher` + copias en `notification-copy.ts`, segmentados por preset (van en `key_events` y `complete` como alta relevancia):

- Inicio de prórroga: "⏱️ {A} y {B} jugarán prórroga tras empatar {x-x}."
- Inicio de penaltis: "🎯 El {A}-{B} se decide en los penaltis."
- Final tras prórroga / penaltis: variar `finalAlert` según `win_type` para reflejar el contexto.

Detección por transición de `status` (`live→overtime`, `overtime→penalty_shootout`), igual que ya hacemos con el borde `scheduled→live`.

### Estadísticas e histórico

La **clasificación no requiere cambios**: se scrapea de la fuente (`standing.loader.ts:56-61` usa `raw.points/won/drawn/lost`), así que prórroga/penaltis ya están en los puntos. Sí conviene: separar goles de prórroga en stats de jugador/equipo (que `home_score` no infle el "goles a favor" si quieres distinguir), y guardar `win_type` para futuros análisis ("% de eliminatorias resueltas en penaltis").

---

## Plan por fases (recomendado)

1. **Backend + corrección de ganador (alta):** migración, tipos, mapeo de estado en el scraper, `winner_team_id`, y arreglar `playoff.ts`/`CompetitionClient`/`PlayoffBracket`. Esto ya quita el bug de atribución aunque la UI siga mostrando solo el marcador.
2. **Parser de la ficha:** rellenar `home_pen/away_pen/win_type` desde el acta (tras confirmar el dato con `live-probe`).
3. **Front:** helper de resultado + aplicarlo en todas las pantallas.
4. **Notificaciones:** eventos de prórroga/penaltis y copias por `win_type`.
5. **Stats/histórico:** separar goles de prórroga y exponer `win_type`.

**Dependencia bloqueante de la Fase 2:** confirmar qué entrega la fuente FEP (¿marca el estado "prórroga"? ¿da el marcador de la tanda?). Si no lo da, la Fase 1 (corrección de ganador vía `winner_team_id` derivado del marcador final + signo de la serie) aporta valor igual, y el resto queda condicionado a la disponibilidad del dato.

---

*Evidencias citadas con `archivo:línea` sobre el árbol actual. Pendiente de validar con `live-probe` la disponibilidad del dato de prórroga/penaltis en el origen antes de la Fase 2.*
