# Competición con eliminatorias — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que en fase final la competición abra en el cuadro con su nombre correcto, que Jornadas incluya las rondas eliminatorias y que la ficha diga en qué fase se juega el partido.

**Architecture:** Las decisiones viven en funciones puras de `apps/web/src/lib` (`season-phases.ts`, `stage-label.ts`) y en `GameweeksTab` (exportadas para test). La API solo añade un objeto `round` al DTO del partido.

**Tech Stack:** Next.js 16 + React 18 + vitest (node, `renderToStaticMarkup`), API Hono + pg.

**Spec:** `docs/superpowers/specs/2026-10-16-competicion-eliminatorias-design.md`

## Global Constraints

- Enlaces existentes `?tab=`, `?journey=` siguen funcionando igual.
- Rondas heredadas sin `stage` no cambian de comportamiento.
- Cambio de API aditivo. `match-stream` y `match-detail` comparten el mismo SELECT de ronda.
- Claves i18n nuevas en secciones existentes (`match_tabs`, `playoffs`, `match_detail`) en los 5 idiomas, nunca un bloque nuevo al final del JSON (evita conflicto con el PR #397).

---

### Task 1: Pestañas (cuadro primero y nombre)

**Files:** `apps/web/src/lib/season-phases.ts` (+ test), `components/competition/CompetitionClient.tsx`, locales.

**Produces:** `finalPhaseStarted(matches): boolean`, `knockoutTabLabelKey(format, phases, rounds, matches): string`, `competitionVisibleTabs` con el cuadro primero cuando `finalPhaseStarted`.

- [ ] Tests que fallan: liga sin playoff → false, playoff con grupos abiertos y nada jugado → false, grupos cerrados + playoff programado → true, eliminatoria jugada → true. Etiqueta: series → `match_tabs.playoffs`, bracket → `match_tabs.knockout`, final four → `playoffs.final_four`, sin fases → `match_tabs.playoffs`. Orden: `['Playoffs','Clasificación','Jornadas']` en fase final.
- [ ] Implementar y pasar. Commit.

### Task 2: Jornadas con rondas eliminatorias

**Files:** `components/competition/GameweeksTab.tsx`, `components/competition/format.ts` (+ tests), locales.

**Produces:** `selectableRounds(rounds, matches): SeasonRound[]`, `roundLabel` con fase, filtro por `?round=<id>`, `pickDefaultFilter` que devuelve `{ roundId }` para eliminatorias.

- [ ] Tests que fallan: incluye eliminatorias con `stage`, excluye las heredadas, orden jornadas → eliminatorias por fecha → por fase, etiquetas, filtro por id de ronda, defecto en la ronda eliminatoria más cercana.
- [ ] Implementar y pasar. Commit.

### Task 3: Fase en la ficha

**Files:** `apps/api/src/lib/match-dto.ts` (+ test), `routes/match-detail.ts`, `routes/match-stream.ts`, `apps/web/src/lib/api/client.ts|types.ts`, `apps/web/src/lib/stage-label.ts` (+ test), `components/match/MatchHeader.tsx`.

**Produces:** `MatchDto.match.round`, `matchRoundLabel(round, t): string | null`.

- [ ] Tests que fallan (API): DTO con ronda de semis y con `null`. (Web): grupos, liga, semis, serie, colocación, sin ronda.
- [ ] Implementar y pasar. Commit.

### Task 4: Verificación y PR

- [ ] typecheck, lint, test (web y api), integración contra Postgres, `next build`.
- [ ] Capturas: Mundial (cuadro primero, Jornadas en Semifinales, ficha de semifinal) y OK Liga (sin cambios).
- [ ] PR.
