# WSG Asunción 2026 — 4 competiciones World Skate en Stick Live

> **For agentic workers:** ejecución inline en esta sesión (patrón executing-plans). Pasos con checkbox para seguimiento.

**Goal:** Añadir las 4 competiciones de rink hockey de los World Skate Games Asunción 2026 (idc sidgad 325/329/330/331) con su formato real (grupos + fase final + clasificación) y una categoría "Mundo" en la web.

**Architecture:** Reutilizar el pipeline World Skate existente (portal sidgad `worldskate`, fuente `worldskate_hockey`, refs `wse_*`): el scraper ya lee el calendario completo multi-fase de cada idc. Se extiende para reconocer las fases de ASU26 (FINAL PHASE, 5TH-8TH), emitir la estructura de rondas como datos (incluidas las rondas de eliminatoria aún sin equipos publicados), asignar `group_name` a los partidos de grupo, y convertir horas de Paraguay. Seed data-driven de competiciones/temporadas/equipos/grupos. Web: etiqueta "Mundo" + ronda "por determinar" en el cuadro + chip de grupo.

**Fuentes del formato (verificadas):** Competition System Rink Hockey WSG 2024 (worldskate.org doc 6805), Rink Hockey Competition Format WSG 2024 (doc 6707), noticias oficiales WS 2026 (sorteo 09/07/2026, previa 02/10/2026), portal oficial `rinkhockey.worldskate.org` (APIs sidgad `worldskate_ls_1.php` / `worldskate_cal_idc_{IDC}_1.php`).

**Decisión clave (participantes dinámicos):** los cruces de la fase final aún no tienen equipos en la fuente. NO se crean equipos ficticios ni se relajan las FK: las rondas existen como estructura de datos y los partidos se insertan cuando la fuente publica equipos (re-scrape cada 5 min los adopta; el mecanismo `synthetic:` del loader ya gestiona la llegada del idp).

---

### Task 1: Migración 062 — `matches.group_name`

**Files:**
- Create: `packages/db/migrations/062_match_group_name.sql`

- [ ] Escribir migración: `ALTER TABLE matches ADD COLUMN IF NOT EXISTS group_name TEXT;` + COMMENT (grupo de la fase de grupos; NULL en eliminatorias).
- [ ] `npm run db:migrate` (BD local) y verificar columna.

### Task 2: Timezone America/Asuncion (UTC-4 fijo)

**Files:**
- Modify: `apps/scraper/src/core/eu-timezone.ts`
- Test: `apps/scraper/src/core/eu-timezone.test.ts`

- [ ] Test que falla: `zonedToUtc('America/Asuncion', 2026, 9, 12, 13, 15)` → `2026-10-12T17:15:00Z`.
- [ ] Implementar: mapa `FIXED_OFFSET = { 'America/Asuncion': -4 }` con rama sin DST en `zonedToUtc` (Paraguay: horario permanente desde 2024).
- [ ] Test en verde.

### Task 3: Scraper — fases/rondas ASU26, rondas como salida, group_name

**Files:**
- Modify: `apps/scraper/src/scrapers/worldskate/worldskate.scraper.ts`
- Modify: `packages/shared-types/src/index.ts` (ScrapedRound + groupName en ScrapedMatch)
- Test: `apps/scraper/src/scrapers/worldskate/worldskate.asu26.test.ts`

Cambios (genéricos por título de fase, sin hardcodear ids de competición):
- `classifyPhase`: `FINAL PHASE` → knockout; `5TH - 8TH PLACE|POSITION` → placement (conservar patrones WSE).
- `normalizeRoundName`: `GOLD MEDAL` → `Final`; `BRONZE MEDAL|BRONCE MEDAL` → `3º y 4º puesto`; `5TH - 8TH PLACE|POSITION` → `Puestos 5º-8º`; `5TH - 6TH` → `Puestos 5º-6º`; `7TH - 8TH` → `Puestos 7º-8º`.
- `computeRound` knockout: Cuartos 90 / Semifinal 95 / 3º y 4º 98 / Final 99 / Puestos 5º-8º 74 / 5º-6º 75 / 7º-8º 77 (los dos últimos ya existían en WSE con 70+n; 74 para las semis de consolación).
- Grupos: jornada por `gamedate` (orden cronológico, no por thead); nombre de grupo desde thead multilenguaje (`GRUPO GROUP GRUPO A PTS...` → `A`).
- Filas de eliminatoria sin equipos (participantes sin publicar): NO emiten partido; sí contribuyen a la salida `rounds`.
- Nueva salida `rounds: ScrapeResult<ScrapedRound>` con toda la estructura vista.
- Reordenar parsing: standings antes que partidos (mapa nombre/logo→grupo) y jornada tras coleccionar fechas.

- [ ] Test con fixture HTML mínimo (GROUP PHASE 2 jornadas + FINAL PHASE con QF/SF/GOLD/BRONZE vacíos + tabla clasificación "GRUPO GROUP GRUPO A"): partidos de grupo con groupName, filas vacías saltadas, rounds esperados.
- [ ] Implementar. Test en verde.

### Task 4: ETL — carga de rondas y group_name

**Files:**
- Modify: `packages/db/src/queries/matches.ts` (upsertMatch: columna group_name)
- Modify: `apps/etl/src/transformers/match.transformer.ts` (schema zod + passthrough)
- Create: `apps/etl/src/loaders/round.loader.ts` (loadRounds → upsertRound)
- Modify: `apps/etl/src/pipeline.ts` (runRounds)
- Modify: `apps/scraper/src/scrapers/worldskate/run-worldskate.ts` (WorldskatePipeline.runRounds + llamada; scrape-log entity 'round')

- [ ] upsertMatch: añadir `group_name` a INSERT y `group_name = COALESCE(EXCLUDED..., matches.group_name)` al UPDATE.
- [ ] transformer: `groupName` opcional validado.
- [ ] loadRounds + pipeline.runRounds + run-worldskate lo invoca.
- [ ] Test de transformer ampliado.

### Task 5: Seed ASU26

**Files:**
- Create: `apps/etl/src/seed-worldskate-asu26.ts`

Datos (todos verificados contra la fuente): 4 competiciones (`source_ref: 'wse_competition_<idc>'` → `resolveWorldskate` las recoge sin cambios), temporadas `wsg-asuncion-2026` con timezone `America/Asuncion` y ventanas reales, 36 selecciones (`team_type='national'`, refs `wse_<idSidgad>`, slug `seleccion-<iso>-<cat>-<gen>`, escudo sidgad.cloud), `season_teams.group_name` según `groups_ids` oficial, `competition_sources` con `format: 'bracket'` + `external_ids {idc, temp: '41', source_url}`. Idempotente (ON CONFLICT).

- [ ] Escribir seed con las tablas de datos.
- [ ] Ejecutar contra BD local y verificar.

### Task 6: Import (scraper) + verificación de datos

- [ ] `--run-once worldskate` contra BD local.
- [ ] SQL de verificación: partidos/rounds/standings por competición, grupos, sin duplicados, ventana de temporada (el GOLD 325 con gamedate 2027 debe ser rechazado explícitamente).

### Task 7: Web — categoría "Mundo" + cuadro con "por determinar" + chip de grupo

**Files:**
- Modify: `apps/web/src/locales/{es,en,fr,it,pt}.json` (`competitions.international` → Mundo/World/Monde/Mondo/Mundo)
- Modify: `apps/api/src/routes/season-overview.ts` (rounds con fechas de ventana; matches con groupName)
- Modify: `apps/web/src/lib/api/client.ts` (tipos)
- Modify: `apps/web/src/components/competition/PlayoffsTab.tsx` (fases declaradas sin partidos → "Por determinar")
- Modify: `apps/web/src/components/competition/GameweeksTab.tsx` (chip Grupo X)

- [ ] Leer docs de Next.js en `apps/web/node_modules/next/dist/docs/` (bloque AGENTS.md) antes de tocar la web.
- [ ] Implementar + typecheck.

### Task 8: Verificación completa

- [ ] `npm run typecheck && npm run lint && npm run test` (raíz).
- [ ] UI local (api :3000 + web :3001): validar las 4 competiciones (pestañas, grupos, cuadro, partido).
- [ ] Consultas de integridad (duplicados, huérfanos, grupos).

### Task 9: Docs + auditoría

- [ ] `docs/pipeline-datos.md` (fuente ASU26) + runbook de la alta.
- [ ] Informe final A-F al usuario.
