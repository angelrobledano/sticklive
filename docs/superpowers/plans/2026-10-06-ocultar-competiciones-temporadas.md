# Ocultar competiciones y temporadas con datos no fiables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una competición o temporada marcada `data_quality = 'en_revision'` deja de ser consultable por cualquier vía (listados, búsqueda, URL directa, endpoints de temporada, ficha de partido, historial de equipo, carrera de jugador, sitemap), y el admin puede marcarla desde el panel.

**Architecture:** Se reutiliza `competitions.data_quality` y se añade `seasons.data_quality` (migración 067). La visibilidad es una regla SQL única: temporada visible ⇔ ella y su competición están en `'ok'`. Un helper `seasonVisible()` guarda los endpoints de temporada/partido; los listados filtran por SQL. La curación vive en endpoints admin protegidos por token y en una pestaña nueva del panel `/admin`.

**Tech Stack:** PostgreSQL (migraciones SQL idempotentes), TypeScript, Hono (API), Next.js 16 + React 18 (web), vitest (unitarios) y vitest `tests/integration` contra Postgres real.

> **Nota sobre commits (AGENTS.md):** el proyecto pide no crear commits salvo petición o workflow.
> Los pasos marcados «Commit» son **opcionales** hasta que el usuario lo autorice. Si se autorizan,
> sigue los mensajes indicados. No crear commits por iniciativa propia.

**Spec:** `docs/superpowers/specs/2026-10-06-ocultar-competiciones-temporadas-design.md`

---

## File Structure

**Nuevos**
- `packages/db/migrations/067_seasons_data_quality.sql` — columna y comentarios.
- `apps/api/src/lib/visibility.ts` — predicado SQL + guarda `seasonVisible`.
- `apps/web/src/components/admin/AdminCompetitions.tsx` — pestaña de curación.
- `tests/integration/visibility-quality.integration.test.ts` — pruebas de comportamiento.

**Modificados**
- `packages/db/src/queries/competitions.ts` — tipo + funciones de calidad.
- `packages/db/src/queries/seasons.ts` — tipo + funciones de calidad.
- `apps/api/src/routes/competitions.ts` — filtrado listado y temporadas.
- `apps/api/src/routes/season-overview.ts` — filtro de visibilidad en la query de temporada.
- `apps/api/src/routes/season-stats.ts` — guarda.
- `apps/api/src/routes/standings.ts` — guarda.
- `apps/api/src/routes/matches.ts` — guarda.
- `apps/api/src/routes/match-detail.ts` — filtro en la query de cabecera.
- `apps/api/src/routes/match-stream.ts` — filtro en la query del snapshot.
- `apps/api/src/routes/live.ts` — filtro en `/live` y `/current`.
- `apps/api/src/routes/search.ts` — filtro de la query de competiciones.
- `apps/api/src/routes/team-detail.ts` — filtro del selector de temporadas.
- `apps/api/src/routes/player-detail.ts` — filtro de equipo, stats y carrera.
- `apps/api/src/routes/meta.ts` — filtro del sitemap.
- `apps/api/src/routes/admin.ts` — endpoints de calidad.
- `apps/api/src/routes/admin.test.ts` — guards de los nuevos endpoints.
- `apps/web/src/components/competition/CompetitionsList.tsx` — quitar etiqueta.
- `apps/web/src/lib/api/types.ts` — actualizar el comentario del campo.
- `apps/web/src/app/[locale]/admin/page.tsx` — pestañas.
- `docs/database.md`, `docs/RUNBOOK_COMPETICIONES.md` — documentación.

---

## Task 1: Migración `067_seasons_data_quality.sql`

**Files:**
- Create: `packages/db/migrations/067_seasons_data_quality.sql`

- [ ] **Step 1: Crear la migración**

Contenido exacto del fichero:

```sql
-- ============================================================
-- 067 — Fiabilidad de la temporada (ocultado por calidad).
--
-- Hoy `competitions.data_quality` (#230, migración 064) se ETIQUETA en la web
-- ("Datos en revisión") pero no se oculta. El producto pasa a ocultar: una
-- competición o temporada con data_quality <> 'ok' deja de ser consultable por
-- el usuario (listados, búsqueda, URL directa, endpoints de temporada, fichas
-- de partido, historial de equipo y carrera de jugador).
--
-- Regla única: temporada visible ⇔ seasons.data_quality='ok' AND
-- competitions.data_quality='ok'. La competición actúa de interruptor maestro.
--
-- Visible por defecto: NO hay backfill. Ocultar es una acción explícita de
-- curación desde el panel admin.
--
-- Idempotente y aditiva.
-- ============================================================

ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS data_quality TEXT NOT NULL DEFAULT 'ok'
    CHECK (data_quality IN ('ok', 'en_revision'));

COMMENT ON COLUMN seasons.data_quality IS
  'Fiabilidad de la temporada: ok (defecto) | en_revision. Si no es ok, la temporada y todo su contenido (calendario, clasificación, partidos y fichas derivadas) dejan de ser consultables por el usuario. Ver migración 067.';

COMMENT ON COLUMN competitions.data_quality IS
  'Fiabilidad de la competición: ok | en_revision. Ya no se etiqueta: un valor distinto de ok oculta la competición y todo su contenido para el usuario (migraciones 064 y 067).';
```

- [ ] **Step 2: Aplicar las migraciones desde cero (integración)**

Run (desde la raíz, con Docker disponible):
```bash
npm run test:integration:docker
```
Expected: la base de pruebas arranca, `[tests] N migraciones aplicadas` y la suite pasa (todavía sin tests de visibilidad: los existentes deben seguir verdes). Si no hay Docker, saltar a la verificación final.

- [ ] **Step 3: Verificar idempotencia**

Run:
```bash
docker compose -f docker-compose.test.yml up -d --wait
DATABASE_URL=postgresql://test:test@127.0.0.1:5433/sticklive_test npm run test:integration
docker compose -f docker-compose.test.yml down
```
Expected: segunda ejecución con el esquema ya migrado (`[tests] esquema ya al día`) y verde.

- [ ] **Step 4: Commit (opcional)**

```bash
git add packages/db/migrations/067_seasons_data_quality.sql
git commit -m "feat(db): flag de fiabilidad en seasons (migración 067)"
```

---

## Task 2: Funciones de calidad en `@sports/db`

**Files:**
- Modify: `packages/db/src/queries/competitions.ts`
- Modify: `packages/db/src/queries/seasons.ts`
- Test: `tests/integration/visibility-quality.integration.test.ts` (se crea aquí y se amplía en tareas siguientes)

- [ ] **Step 1: Escribir el test de integración (fallará: funciones sin definir)**

Crear `tests/integration/visibility-quality.integration.test.ts`:

```ts
/**
 * Visibilidad por calidad de datos: competiciones y temporadas marcadas
 * 'en_revision' dejan de ser consultables por cualquier vía.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  db, closeDb,
  listCompetitionsForQuality, setCompetitionQuality,
  listSeasonsForQuality, setSeasonQuality,
} from '@sports/db';
import { limpiar } from './support/db.js';
import {
  crearDeporte, crearCompeticion, crearTemporada, crearPartido,
} from './support/factorias.js';

async function get(router: { request: (p: string, init?: RequestInit) => Promise<Response> }, path: string) {
  const res = await router.request(path);
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function setCompQualityDirect(id: string, q: string) {
  await db.query(`UPDATE competitions SET data_quality = $2 WHERE id = $1`, [id, q]);
}
async function setSeasonQualityDirect(id: string, q: string) {
  await db.query(`UPDATE seasons SET data_quality = $2 WHERE id = $1`, [id, q]);
}

let sportId: string;

beforeEach(async () => {
  await limpiar();
  sportId = await crearDeporte();
});

afterAll(async () => {
  await closeDb();
});

describe('@sports/db — calidad', () => {
  it('listCompetitionsForQuality cuenta temporadas totales y visibles', async () => {
    const compId = await crearCompeticion(sportId);
    const s1 = await crearTemporada(compId);
    await crearTemporada(compId);
    await setSeasonQualityDirect(s1, 'en_revision');

    const rows = await listCompetitionsForQuality();
    const row = rows.find((r) => r.id === compId);
    expect(row).toBeDefined();
    expect(row!.data_quality).toBe('ok');
    expect(Number(row!.season_count)).toBe(2);
    expect(Number(row!.visible_season_count)).toBe(1);
  });

  it('setCompetitionQuality y setSeasonQuality cambian el flag', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);

    expect((await setCompetitionQuality(compId, 'en_revision'))?.data_quality).toBe('en_revision');
    expect((await setSeasonQuality(seasonId, 'en_revision'))?.data_quality).toBe('en_revision');

    const seasons = await listSeasonsForQuality(compId);
    expect(seasons.find((s) => s.id === seasonId)!.data_quality).toBe('en_revision');
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run (con la base de pruebas arriba):
```bash
npx vitest run --config vitest.integration.config.ts tests/integration/visibility-quality.integration.test.ts
```
Expected: FAIL — `listCompetitionsForQuality` no está exportado.

- [ ] **Step 3: Añadir tipos y funciones a `competitions.ts`**

En `packages/db/src/queries/competitions.ts`, añadir `data_quality` al interface `DbCompetition` (después de `archived_at`):

```ts
  archived_at: Date | null;
  data_quality: string;
```

Y al final del fichero (tras `mergeCompetitions`):

```ts
// ── Calidad de datos / visibilidad (migración 067) ───────────────────────────

export type DataQuality = 'ok' | 'en_revision';

export interface CompetitionQualityRow {
  id: string;
  name: string;
  slug: string;
  data_quality: string;
  archived_at: Date | null;
  season_count: string;
  visible_season_count: string;
}

/** Lista TODAS las competiciones (incl. archivadas/ocultas) con recuento de temporadas. */
export async function listCompetitionsForQuality(): Promise<CompetitionQualityRow[]> {
  const result = await db.query<CompetitionQualityRow>(`
    SELECT c.id, c.name, c.slug, c.data_quality, c.archived_at,
           COUNT(s.id)::text AS season_count,
           COUNT(s.id) FILTER (WHERE s.data_quality = 'ok')::text AS visible_season_count
      FROM competitions c
      LEFT JOIN seasons s ON s.competition_id = c.id
     GROUP BY c.id
     ORDER BY c.name
  `);
  return result.rows;
}

/** Marca la fiabilidad de una competición. Devuelve null si no existe. */
export async function setCompetitionQuality(
  id: string,
  quality: DataQuality
): Promise<DbCompetition | null> {
  const result = await db.query<DbCompetition>(
    `UPDATE competitions SET data_quality = $2, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, quality]
  );
  return result.rows[0] ?? null;
}
```

- [ ] **Step 4: Añadir tipos y funciones a `seasons.ts`**

En `packages/db/src/queries/seasons.ts`, importar el tipo y añadir `data_quality` al interface `DbSeason`:

```ts
import type { DataQuality } from './competitions.js';
```
```ts
  scraped_at: Date | null;
  data_quality: string;
```
(insertar `data_quality` tras `scraped_at` en `DbSeason`)

Y al final del fichero:

```ts
// ── Calidad de datos / visibilidad (migración 067) ───────────────────────────

export interface SeasonQualityRow {
  id: string;
  name: string;
  slug: string;
  is_current: boolean;
  data_quality: string;
  match_count: string;
}

/** Lista TODAS las temporadas de una competición (incl. ocultas). */
export async function listSeasonsForQuality(competitionId: string): Promise<SeasonQualityRow[]> {
  const result = await db.query<SeasonQualityRow>(`
    SELECT s.id, s.name, s.slug, s.is_current, s.data_quality,
           COUNT(m.id)::text AS match_count
      FROM seasons s
      LEFT JOIN matches m ON m.season_id = s.id
     WHERE s.competition_id = $1
     GROUP BY s.id
     ORDER BY s.is_current DESC, s.start_date DESC NULLS LAST, s.name DESC
  `, [competitionId]);
  return result.rows;
}

/** Marca la fiabilidad de una temporada. Devuelve null si no existe. */
export async function setSeasonQuality(
  id: string,
  quality: DataQuality
): Promise<DbSeason | null> {
  const result = await db.query<DbSeason>(
    `UPDATE seasons SET data_quality = $2, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, quality]
  );
  return result.rows[0] ?? null;
}
```

- [ ] **Step 5: Ejecutar el test y ver que pasa**

Run:
```bash
npx vitest run --config vitest.integration.config.ts tests/integration/visibility-quality.integration.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck del paquete**

Run:
```bash
npm run typecheck --workspace=@sports/db
```
Expected: sin errores.

- [ ] **Step 7: Commit (opcional)**

```bash
git add packages/db/src/queries/competitions.ts packages/db/src/queries/seasons.ts tests/integration/visibility-quality.integration.test.ts
git commit -m "feat(db): funciones de calidad de competiciones y temporadas"
```

---

## Task 3: Helper de visibilidad de la API

**Files:**
- Create: `apps/api/src/lib/visibility.ts`

- [ ] **Step 1: Crear el helper**

Contenido exacto:

```ts
import { db } from '@sports/db';

/**
 * Predicado SQL de visibilidad por calidad (migración 067). Asume que la
 * consulta tiene los alias `s` (seasons) y `c` (competitions).
 */
export const SEASON_VISIBLE_SQL = "s.data_quality = 'ok' AND c.data_quality = 'ok'";

/**
 * ¿La temporada existe y es consultable? Visible ⇔ ella y su competición en
 * 'ok'. Se usa como guarda antes de servir cualquier endpoint de temporada o
 * de partido; devuelve false tanto si no existe como si está oculta, para no
 * revelar la existencia de datos no fiables.
 */
export async function seasonVisible(seasonId: string): Promise<boolean> {
  const res = await db.query(
    `SELECT 1
       FROM seasons s
       JOIN competitions c ON c.id = s.competition_id
      WHERE s.id = $1 AND ${SEASON_VISIBLE_SQL}
      LIMIT 1`,
    [seasonId]
  );
  return (res.rowCount ?? 0) > 0;
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
npm run typecheck --workspace=@sports/api
```
Expected: sin errores.

- [ ] **Step 3: Commit (opcional)**

```bash
git add apps/api/src/lib/visibility.ts
git commit -m "feat(api): helper de visibilidad por calidad"
```

---

## Task 4: Filtrado en `/competitions` y `/competitions/:id/seasons`

**Files:**
- Modify: `apps/api/src/routes/competitions.ts`
- Test: `tests/integration/visibility-quality.integration.test.ts`

- [ ] **Step 1: Añadir el test que falla**

Primero añade el import arriba del fichero (junto a los demás):
```ts
import { competitionsRouter } from '../../apps/api/src/routes/competitions.js';
```
Después añade al final:

```ts
describe('GET /competitions — filtrado por calidad', () => {
  it('excluye competiciones ocultas y no devuelve su temporada de referencia', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    await crearPartido({ seasonId });

    const visible = await get(competitionsRouter, '/');
    const vBody = visible.body as { competitions: Array<{ id: string }> };
    expect(vBody.competitions.some((c) => c.id === compId)).toBe(true);

    await setCompQualityDirect(compId, 'en_revision');

    const hidden = await get(competitionsRouter, '/');
    const hBody = hidden.body as { competitions: Array<{ id: string }> };
    expect(hBody.competitions.some((c) => c.id === compId)).toBe(false);
  });

  it('solo lista temporadas visibles y 404 si la competición queda vacía', async () => {
    const compId = await crearCompeticion(sportId);
    const s1 = await crearTemporada(compId);
    const s2 = await crearTemporada(compId);
    await crearPartido({ seasonId: s1 });
    await crearPartido({ seasonId: s2 });

    await setSeasonQualityDirect(s2, 'en_revision');

    const res = await get(competitionsRouter, `/${compId}/seasons`);
    expect(res.status).toBe(200);
    const body = res.body as { seasons: Array<{ id: string }> };
    expect(body.seasons.map((s) => s.id)).toEqual([s1]);

    await setSeasonQualityDirect(s1, 'en_revision');
    const empty = await get(competitionsRouter, `/${compId}/seasons`);
    expect(empty.status).toBe(404);
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run:
```bash
npx vitest run --config vitest.integration.config.ts tests/integration/visibility-quality.integration.test.ts
```
Expected: FAIL — las competiciones/temporadas ocultas siguen apareciendo.

- [ ] **Step 3: Filtrar en el listado `/`**

En `apps/api/src/routes/competitions.ts`, dentro del `LATERAL`, añadir `s2.data_quality = 'ok'`:
```sql
          SELECT s2.id FROM seasons s2
          WHERE s2.competition_id = comp.id
            AND s2.data_quality = 'ok'
            AND EXISTS (SELECT 1 FROM matches m WHERE m.season_id = s2.id)
```
Y cambiar la línea `WHERE TRUE ` + archivedClause por:
```sql
        WHERE comp.data_quality = 'ok' ` + archivedClause + `
```

- [ ] **Step 4: Filtrar en `/:id/seasons`**

Sustituir la query del handler por:

```ts
      `SELECT s.id, s.name, s.slug, s.is_current, s.start_date
        FROM seasons s
        JOIN competitions c ON c.id = s.competition_id
        WHERE s.competition_id = $1
          AND s.data_quality = 'ok'
          AND c.data_quality = 'ok'
          AND EXISTS (SELECT 1 FROM matches m WHERE m.season_id = s.id)
        ORDER BY s.start_date DESC NULLS LAST, s.name DESC`,
```

- [ ] **Step 5: Ejecutar y ver que pasa**

Run:
```bash
npx vitest run --config vitest.integration.config.ts tests/integration/visibility-quality.integration.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit (opcional)**

```bash
git add apps/api/src/routes/competitions.ts tests/integration/visibility-quality.integration.test.ts
git commit -m "feat(api): /competitions oculta lo marcado en_revision"
```

---

## Task 5: Guardas en los endpoints de temporada

**Files:**
- Modify: `apps/api/src/routes/season-overview.ts`
- Modify: `apps/api/src/routes/season-stats.ts`
- Modify: `apps/api/src/routes/standings.ts`
- Modify: `apps/api/src/routes/matches.ts`
- Test: `tests/integration/visibility-quality.integration.test.ts`

- [ ] **Step 1: Añadir el test que falla**

Añadir al fichero de integración (con los imports arriba):

```ts
import { seasonOverviewRouter } from '../../apps/api/src/routes/season-overview.js';
import { seasonStatsRouter } from '../../apps/api/src/routes/season-stats.js';
import { standingsRouter } from '../../apps/api/src/routes/standings.js';
import { matchesRouter } from '../../apps/api/src/routes/matches.js';

describe('endpoints de temporada — visibilidad', () => {
  it('404 en overview/stats/standings/matches cuando la temporada está oculta', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    await crearPartido({ seasonId });

    expect((await get(seasonOverviewRouter, `/${seasonId}/overview`)).status).toBe(200);
    expect((await get(seasonStatsRouter, `/${seasonId}/stats`)).status).toBe(200);

    await setSeasonQualityDirect(seasonId, 'en_revision');

    expect((await get(seasonOverviewRouter, `/${seasonId}/overview`)).status).toBe(404);
    expect((await get(seasonStatsRouter, `/${seasonId}/stats`)).status).toBe(404);
    expect((await get(standingsRouter, `/${seasonId}/standings`)).status).toBe(404);
    expect((await get(matchesRouter, `/${seasonId}/matches`)).status).toBe(404);
  });

  it('la competición oculta todo su contenido aunque la temporada esté ok', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    await crearPartido({ seasonId });
    await setCompQualityDirect(compId, 'en_revision');

    expect((await get(seasonOverviewRouter, `/${seasonId}/overview`)).status).toBe(404);
    expect((await get(standingsRouter, `/${seasonId}/standings`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run:
```bash
npx vitest run --config vitest.integration.config.ts tests/integration/visibility-quality.integration.test.ts
```
Expected: FAIL — overview/stats/standings/matches siguen respondiendo 200/404-de-datos (no el 404 de guarda).

- [ ] **Step 3: `season-overview.ts` — filtrar la query de temporada**

En `apps/api/src/routes/season-overview.ts`, en la query 1 (la de `FROM seasons s JOIN competitions c`), añadir a su `WHERE`:

```sql
        WHERE s.id = $1
          AND s.data_quality = 'ok'
          AND c.data_quality = 'ok'
```
El `if (seasonRes.rows.length === 0) return c.json({ error: 'Season not found' }, 404);` existente se encarga del 404.

- [ ] **Step 4: `season-stats.ts` — guarda**

Añadir el import:
```ts
import { seasonVisible } from '../lib/visibility.js';
```
Tras la validación de UUID (`if (!isUuid(seasonId))`), añadir antes del `try`:
```ts
  if (!(await seasonVisible(seasonId))) return c.json({ error: 'Not found' }, 404);
```

- [ ] **Step 5: `standings.ts` — guarda**

Añadir el import:
```ts
import { seasonVisible } from '../lib/visibility.js';
```
Tras la validación de UUID, antes del `try`:
```ts
  if (!(await seasonVisible(seasonId))) return c.json({ error: 'Not found' }, 404);
```

- [ ] **Step 6: `matches.ts` — guarda**

Añadir el import:
```ts
import { seasonVisible } from '../lib/visibility.js';
```
Tras la validación de UUID de `seasonId`, antes del `try`:
```ts
  if (!(await seasonVisible(seasonId))) return c.json({ error: 'Not found' }, 404);
```

- [ ] **Step 7: Ejecutar y ver que pasa**

Run:
```bash
npx vitest run --config vitest.integration.config.ts tests/integration/visibility-quality.integration.test.ts
```
Expected: PASS.

- [ ] **Step 8: Commit (opcional)**

```bash
git add apps/api/src/routes/season-overview.ts apps/api/src/routes/season-stats.ts apps/api/src/routes/standings.ts apps/api/src/routes/matches.ts tests/integration/visibility-quality.integration.test.ts
git commit -m "feat(api): temporadas ocultas no consultables"
```

---

## Task 6: Partidos: ficha, stream y en directo

**Files:**
- Modify: `apps/api/src/routes/match-detail.ts`
- Modify: `apps/api/src/routes/match-stream.ts`
- Modify: `apps/api/src/routes/live.ts`
- Test: `tests/integration/visibility-quality.integration.test.ts`

- [ ] **Step 1: Añadir el test que falla**

Añadir al fichero de integración:

```ts
import { matchDetailRouter } from '../../apps/api/src/routes/match-detail.js';

describe('partidos — visibilidad', () => {
  it('404 en la ficha del partido cuando su temporada está oculta', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    const { matchId } = await crearPartido({ seasonId });

    expect((await get(matchDetailRouter, `/${matchId}`)).status).toBe(200);

    await setSeasonQualityDirect(seasonId, 'en_revision');
    expect((await get(matchDetailRouter, `/${matchId}`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run:
```bash
npx vitest run --config vitest.integration.config.ts tests/integration/visibility-quality.integration.test.ts
```
Expected: FAIL — la ficha sigue devolviendo 200.

- [ ] **Step 3: `match-detail.ts` — filtrar la cabecera**

En la query 1, añadir al `WHERE`:
```sql
        WHERE m.id = $1
          AND s.data_quality = 'ok'
          AND comp.data_quality = 'ok'
```
(la query ya hace `LEFT JOIN seasons s` y `LEFT JOIN competitions comp`). El `if (matchResult.rows.length === 0) return 404` existente se encarga.

- [ ] **Step 4: `match-stream.ts` — filtrar el snapshot**

En `fetchMatchSnapshot`, en la query de cabecera (la primera), añadir al `WHERE`:
```sql
      WHERE m.id = $1
        AND s.data_quality = 'ok'
        AND comp.data_quality = 'ok'
```
Si `row` es null el snapshot devuelve `null` y el hub ya responde el `SSE_NOT_FOUND_ERROR` existente; no hay que añadir nada más.

- [ ] **Step 5: `live.ts` — filtrar `/live` y `/current`**

En la query de `/live`, añadir al `WHERE m.status = 'live'`:
```sql
      WHERE m.status = 'live'
        AND s2.data_quality = 'ok'
        AND comp.data_quality = 'ok'
```
En la query de `/current`, añadir al `WHERE m.status IN ('scheduled', 'live', 'finished')`:
```sql
      WHERE m.status IN ('scheduled', 'live', 'finished')
        AND s.data_quality = 'ok'
        AND comp.data_quality = 'ok'
        ${where}
```

- [ ] **Step 6: Ejecutar y ver que pasa**

Run:
```bash
npx vitest run --config vitest.integration.config.ts tests/integration/visibility-quality.integration.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit (opcional)**

```bash
git add apps/api/src/routes/match-detail.ts apps/api/src/routes/match-stream.ts apps/api/src/routes/live.ts tests/integration/visibility-quality.integration.test.ts
git commit -m "feat(api): partidos de temporadas ocultas no consultables"
```

---

## Task 7: Búsqueda

**Files:**
- Modify: `apps/api/src/routes/search.ts`
- Test: `tests/integration/visibility-quality.integration.test.ts`

- [ ] **Step 1: Añadir el test que falla**

```ts
import { searchRouter } from '../../apps/api/src/routes/search.js';

describe('GET /search — visibilidad', () => {
  it('no devuelve competiciones ocultas', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    await crearPartido({ seasonId });
    const { rows } = await db.query<{ name: string }>(`SELECT name FROM competitions WHERE id = $1`, [compId]);
    const name = rows[0]!.name;

    const visible = await searchRouter.request(`/?q=${encodeURIComponent(name)}`);
    const vBody = await visible.json() as { competitions: Array<{ id: string }> };
    expect(vBody.competitions.some((c) => c.id === compId)).toBe(true);

    await setCompQualityDirect(compId, 'en_revision');

    const hidden = await searchRouter.request(`/?q=${encodeURIComponent(name)}`);
    const hBody = await hidden.json() as { competitions: Array<{ id: string }> };
    expect(hBody.competitions.some((c) => c.id === compId)).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run:
```bash
npx vitest run --config vitest.integration.config.ts tests/integration/visibility-quality.integration.test.ts
```
Expected: FAIL — la competición oculta sigue apareciendo.

- [ ] **Step 3: Filtrar `COMPETITION_QUERY`**

En `apps/api/src/routes/search.ts`, sustituir el `LEFT JOIN LATERAL` y el `WHERE` de `COMPETITION_QUERY`:

```sql
  FROM competitions comp
  JOIN LATERAL (
    SELECT s2.name
    FROM seasons s2
    WHERE s2.competition_id = comp.id
      AND s2.data_quality = 'ok'
      AND EXISTS (SELECT 1 FROM matches m WHERE m.season_id = s2.id)
    ORDER BY s2.is_current DESC, s2.start_date DESC NULLS LAST
    LIMIT 1
  ) s ON TRUE
  WHERE comp.archived_at IS NULL
    AND comp.data_quality = 'ok'
    AND (
      strpos(${unaccentExpr('comp.name')}, $1) > 0
      OR strpos(${unaccentExpr("coalesce(comp.short_name, '')")}, $1) > 0
    )
```

(El `JOIN LATERAL` interior sustituye al `LEFT JOIN` para descartar competiciones sin temporada visible con partidos.)

- [ ] **Step 4: Ejecutar y ver que pasa**

Run:
```bash
npx vitest run --config vitest.integration.config.ts tests/integration/visibility-quality.integration.test.ts
```
Expected: PASS.

- [ ] **Step 5: Unitarios de búsqueda intactos**

Run:
```bash
npm test --workspace=@sports/api
```
Expected: PASS.

- [ ] **Step 6: Commit (opcional)**

```bash
git add apps/api/src/routes/search.ts tests/integration/visibility-quality.integration.test.ts
git commit -m "feat(api): la búsqueda oculta competiciones en_revision"
```

---

## Task 8: Ficha de equipo y de jugador

**Files:**
- Modify: `apps/api/src/routes/team-detail.ts`
- Modify: `apps/api/src/routes/player-detail.ts`
- Test: `tests/integration/visibility-quality.integration.test.ts`

- [ ] **Step 1: Añadir el test que falla**

```ts
import { teamDetailRouter } from '../../apps/api/src/routes/team-detail.js';
import { playerDetailRouter } from '../../apps/api/src/routes/player-detail.js';

describe('fichas — visibilidad', () => {
  it('la ficha de equipo no ofrece temporadas ocultas', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    const { homeTeamId } = await crearPartido({ seasonId });

    const visible = await get(teamDetailRouter, `/${homeTeamId}`);
    expect((visible.body as { seasons: Array<{ id: string }> }).seasons.some((s) => s.id === seasonId)).toBe(true);

    await setSeasonQualityDirect(seasonId, 'en_revision');

    const hidden = await get(teamDetailRouter, `/${homeTeamId}`);
    expect((hidden.body as { seasons: Array<{ id: string }> }).seasons.some((s) => s.id === seasonId)).toBe(false);
  });

  it('la ficha de jugador no expone carrera de temporadas ocultas', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    const { homeTeamId } = await crearPartido({ seasonId });
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO players (sport_id, first_name, last_name, slug)
       VALUES ($1, 'Test', 'Jugador', 'test-jugador-' || gen_random_uuid()::text) RETURNING id`,
      [sportId]
    );
    const playerId = rows[0]!.id;
    await db.query(
      `INSERT INTO team_players (season_id, team_id, player_id) VALUES ($1, $2, $3)`,
      [seasonId, homeTeamId, playerId]
    );

    const visible = await get(playerDetailRouter, `/${playerId}`);
    expect((visible.body as { career: { seasons: Array<{ seasonId: string }> } }).career.seasons.length).toBeGreaterThan(0);

    await setCompQualityDirect(compId, 'en_revision');

    const hidden = await get(playerDetailRouter, `/${playerId}`);
    expect((hidden.body as { career: { seasons: Array<{ seasonId: string }> } }).career.seasons.length).toBe(0);
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run:
```bash
npx vitest run --config vitest.integration.config.ts tests/integration/visibility-quality.integration.test.ts
```
Expected: FAIL — las fichas siguen mostrando temporadas ocultas.

- [ ] **Step 3: `team-detail.ts` — filtrar el selector de temporadas**

En la query del selector (la que hace `FROM seasons se JOIN competitions c`), añadir al `WHERE se.id IN (...)`:

```sql
        WHERE se.id IN (
          SELECT season_id FROM season_teams WHERE team_id = $1
          UNION
          SELECT season_id FROM standings   WHERE team_id = $1
          UNION
          SELECT season_id FROM matches     WHERE home_team_id = $1 OR away_team_id = $1
        )
          AND se.data_quality = 'ok'
          AND c.data_quality = 'ok'
```

- [ ] **Step 4: `player-detail.ts` — filtrar equipo actual, stats y carrera**

Query 2 (equipo actual): añadir `JOIN competitions c ON c.id = s.competition_id` y `AND c.data_quality = 'ok'`:

```sql
      FROM team_players tp
      JOIN teams t   ON t.id  = tp.team_id
      JOIN seasons s ON s.id  = tp.season_id
      JOIN competitions c ON c.id = s.competition_id
      WHERE tp.player_id = $1
        AND tp.is_active  = TRUE
        AND s.data_quality = 'ok'
        AND c.data_quality = 'ok'
```

Query 3 (stats por competición): en la CTE `actividad`, añadir `WHERE` antes del `GROUP BY c.id`:

```sql
          JOIN competitions c ON c.id  = s.competition_id
         WHERE s.data_quality = 'ok' AND c.data_quality = 'ok'
         GROUP BY c.id
```

Query 4 (carrera), rama 1 (`team_players`): añadir tras `WHERE tp.player_id = $1`:
```sql
        AND s.data_quality = 'ok'
        AND c.data_quality = 'ok'
```
Rama 2 (`match_events`): añadir tras `WHERE me.player_id = $1` (antes del `AND NOT EXISTS`):
```sql
        AND s.data_quality = 'ok'
        AND c.data_quality = 'ok'
```

- [ ] **Step 5: Ejecutar y ver que pasa**

Run:
```bash
npx vitest run --config vitest.integration.config.ts tests/integration/visibility-quality.integration.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit (opcional)**

```bash
git add apps/api/src/routes/team-detail.ts apps/api/src/routes/player-detail.ts tests/integration/visibility-quality.integration.test.ts
git commit -m "feat(api): fichas de equipo y jugador respetan la visibilidad"
```

---

## Task 9: Sitemap

**Files:**
- Modify: `apps/api/src/routes/meta.ts`
- Test: `tests/integration/visibility-quality.integration.test.ts`

- [ ] **Step 1: Añadir el test que falla**

```ts
import { metaRouter } from '../../apps/api/src/routes/meta.js';

describe('GET /meta/sitemap — visibilidad', () => {
  it('excluye competiciones y partidos ocultos', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    const { matchId } = await crearPartido({ seasonId });

    const visible = await metaRouter.request('/sitemap');
    const vBody = await visible.json() as { competitions: Array<{ id: string }>; matches: Array<{ id: string }> };
    expect(vBody.competitions.some((c) => c.id === compId)).toBe(true);
    expect(vBody.matches.some((m) => m.id === matchId)).toBe(true);

    await setCompQualityDirect(compId, 'en_revision');

    const hidden = await metaRouter.request('/sitemap');
    const hBody = await hidden.json() as { competitions: Array<{ id: string }>; matches: Array<{ id: string }> };
    expect(hBody.competitions.some((c) => c.id === compId)).toBe(false);
    expect(hBody.matches.some((m) => m.id === matchId)).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run:
```bash
npx vitest run --config vitest.integration.config.ts tests/integration/visibility-quality.integration.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Filtrar en `meta.ts`**

Sustituir las dos queries:

```ts
      db.query<{ id: string; updated_at: Date }>(
        `SELECT id, updated_at FROM competitions
          WHERE data_quality = 'ok' AND archived_at IS NULL`
      ),
```
```ts
      db.query<{ id: string; updated_at: Date; finished_at: Date | null; scheduled_at: Date | null }>(`
        SELECT m.id, m.updated_at, m.finished_at, m.scheduled_at
          FROM matches m
          JOIN seasons s      ON s.id = m.season_id
          JOIN competitions c ON c.id = s.competition_id
         WHERE m.scheduled_at > NOW() - INTERVAL '60 days'
           AND s.data_quality = 'ok'
           AND c.data_quality = 'ok'
         ORDER BY m.scheduled_at DESC
         LIMIT 3000
      `),
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run:
```bash
npx vitest run --config vitest.integration.config.ts tests/integration/visibility-quality.integration.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit (opcional)**

```bash
git add apps/api/src/routes/meta.ts tests/integration/visibility-quality.integration.test.ts
git commit -m "feat(api): el sitemap excluye contenido oculto"
```

---

## Task 10: Endpoints admin de calidad

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/routes/admin.test.ts`
- Test: `tests/integration/visibility-quality.integration.test.ts`

- [ ] **Step 1: Añadir los tests unitarios que fallan**

Añadir a `apps/api/src/routes/admin.test.ts` dentro del `describe` existente (o uno nuevo):

```ts
describe('admin — calidad (guards sin BD)', () => {
  it('PATCH /competitions/:id/quality con uuid inválido → 404', async () => {
    const res = await adminRouter.request('/competitions/xyz/quality', {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ dataQuality: 'ok' }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH /competitions/:id/quality con valor inválido → 400', async () => {
    const res = await adminRouter.request('/competitions/00000000-0000-0000-0000-000000000001/quality', {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ dataQuality: 'nope' }),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /seasons/:id/quality con uuid inválido → 404', async () => {
    const res = await adminRouter.request('/seasons/xyz/quality', {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ dataQuality: 'ok' }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH /seasons/:id/quality con valor inválido → 400', async () => {
    const res = await adminRouter.request('/seasons/00000000-0000-0000-0000-000000000001/quality', {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ dataQuality: 'nope' }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run:
```bash
npm test --workspace=@sports/api
```
Expected: FAIL — 404 en vez de 400 (rutas aún no existen → Hono devuelve 404).

- [ ] **Step 3: Implementar los endpoints en `admin.ts`**

Añadir a los imports de `@sports/db`:
```ts
import {
  db, archiveCompetition, restoreCompetition, mergeCompetitions,
  findDuplicateCandidates, listArchivedCompetitions,
  listResolutionQueue, resolveQueueItem, rejectQueueItem, getResolutionStats,
  listCompetitionsForQuality, setCompetitionQuality,
  listSeasonsForQuality, setSeasonQuality,
} from '@sports/db';
```

Añadir tras el bloque de fusiones (después de `POST /competitions/merge`) un helper y los cuatro endpoints:

```ts
// ── Calidad de datos / visibilidad (migración 067) ───────────────────────────

const QUALITY_VALUES = ['ok', 'en_revision'] as const;
type Quality = (typeof QUALITY_VALUES)[number];

function parseQuality(raw: unknown): Quality | null {
  return raw === 'ok' || raw === 'en_revision' ? raw : null;
}

/**
 * GET /admin/competitions/quality
 * Todas las competiciones (incl. archivadas y ocultas) con recuento de temporadas.
 */
adminRouter.get('/competitions/quality', async (c) => {
  try {
    const competitions = await listCompetitionsForQuality();
    return c.json({ count: competitions.length, competitions });
  } catch (err) {
    captureRouteError(err, 'admin] competitions/quality error');
    logger.error({ err }, '[admin] competitions/quality error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/**
 * GET /admin/competitions/:id/seasons/quality
 * Todas las temporadas de una competición (incl. ocultas).
 */
adminRouter.get('/competitions/:id/seasons/quality', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'Competition not found' }, 404);
  try {
    const seasons = await listSeasonsForQuality(id);
    return c.json({ count: seasons.length, seasons });
  } catch (err) {
    captureRouteError(err, 'admin] seasons/quality error');
    logger.error({ err }, '[admin] seasons/quality error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/**
 * PATCH /admin/competitions/:id/quality  Body: { dataQuality: 'ok' | 'en_revision' }
 */
adminRouter.patch('/competitions/:id/quality', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'Competition not found' }, 404);
  const body = await c.req.json().catch(() => ({})) as { dataQuality?: unknown };
  const quality = parseQuality(body.dataQuality);
  if (!quality) return c.json({ error: "dataQuality must be 'ok' or 'en_revision'" }, 400);
  try {
    const comp = await setCompetitionQuality(id, quality);
    if (!comp) return c.json({ error: 'Competition not found' }, 404);
    return c.json({ ok: true, competition: { id: comp.id, name: comp.name, dataQuality: comp.data_quality } });
  } catch (err) {
    captureRouteError(err, 'admin] set competition quality error');
    logger.error({ err }, '[admin] set competition quality error');
    return c.json({ error: 'Database error' }, 500);
  }
});

/**
 * PATCH /admin/seasons/:id/quality  Body: { dataQuality: 'ok' | 'en_revision' }
 */
adminRouter.patch('/seasons/:id/quality', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'Season not found' }, 404);
  const body = await c.req.json().catch(() => ({})) as { dataQuality?: unknown };
  const quality = parseQuality(body.dataQuality);
  if (!quality) return c.json({ error: "dataQuality must be 'ok' or 'en_revision'" }, 400);
  try {
    const season = await setSeasonQuality(id, quality);
    if (!season) return c.json({ error: 'Season not found' }, 404);
    return c.json({ ok: true, season: { id: season.id, name: season.name, dataQuality: season.data_quality } });
  } catch (err) {
    captureRouteError(err, 'admin] set season quality error');
    logger.error({ err }, '[admin] set season quality error');
    return c.json({ error: 'Database error' }, 500);
  }
});
```

> `DbCompetition.data_quality` y `DbSeason.data_quality` existen desde la Task 2, así que
> `comp.data_quality` / `season.data_quality` tipan sin cast.

- [ ] **Step 4: Ejecutar y ver que pasan los unitarios**

Run:
```bash
npm test --workspace=@sports/api
```
Expected: PASS.

- [ ] **Step 5: Añadir el test de integración y ver pasar**

Añadir al fichero de integración:

```ts
import { adminRouter } from '../../apps/api/src/routes/admin.js';

describe('admin — calidad end-to-end', () => {
  const AUTH = { 'x-admin-token': process.env['ADMIN_TOKEN'] ?? 'test-token' };
  const JSON_AUTH = { ...AUTH, 'content-type': 'application/json' };

  it('PATCH quality oculta y desoculta', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    await crearPartido({ seasonId });

    const hide = await adminRouter.request(`/seasons/${seasonId}/quality`, {
      method: 'PATCH', headers: JSON_AUTH, body: JSON.stringify({ dataQuality: 'en_revision' }),
    });
    expect(hide.status).toBe(200);
    expect((await get(seasonOverviewRouter, `/${seasonId}/overview`)).status).toBe(404);

    const show = await adminRouter.request(`/seasons/${seasonId}/quality`, {
      method: 'PATCH', headers: JSON_AUTH, body: JSON.stringify({ dataQuality: 'ok' }),
    });
    expect(show.status).toBe(200);
    expect((await get(seasonOverviewRouter, `/${seasonId}/overview`)).status).toBe(200);

    const list = await adminRouter.request('/competitions/quality', { headers: AUTH });
    expect(list.status).toBe(200);
  });
});
```

`process.env['ADMIN_TOKEN']` debe estar fijado antes de importar el router. Añadir al inicio
del fichero (antes de los imports estáticos no se puede; el middleware lo lee en cada request,
así que basta con fijarlo en un `beforeAll`):

```ts
import { beforeAll } from 'vitest';
beforeAll(() => { process.env['ADMIN_TOKEN'] ??= 'test-token'; });
```

Run:
```bash
npx vitest run --config vitest.integration.config.ts tests/integration/visibility-quality.integration.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit (opcional)**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts tests/integration/visibility-quality.integration.test.ts
git commit -m "feat(api): endpoints admin de calidad por competición/temporada"
```

---

## Task 11: Web — quitar la etiqueta "Datos en revisión"

**Files:**
- Modify: `apps/web/src/components/competition/CompetitionsList.tsx`
- Modify: `apps/web/src/lib/api/types.ts`

- [ ] **Step 1: Eliminar el bloque de la etiqueta**

En `apps/web/src/components/competition/CompetitionsList.tsx`, borrar:

```tsx
          {/* #230: etiqueta (no oculta) para competiciones cuyo histórico está
              en revisión — el usuario sabe qué está mirando. */}
          {comp.dataQuality === 'en_revision' && (
            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40
                             text-[10px] font-bold text-amber-800 dark:text-amber-300 leading-none">
              {tt(t, 'competitions.en_revision', 'Datos en revisión')}
            </span>
          )}
```

- [ ] **Step 2: Actualizar el comentario del tipo**

En `apps/web/src/lib/api/types.ts`, sustituir el comentario del campo:

```ts
  /** Calidad (#064): el API público solo devuelve competiciones visibles ('ok'). */
  dataQuality?: 'ok' | 'en_revision' | string;
```

- [ ] **Step 3: Comprobar que no quedan referencias a la clave i18n**

Busca `en_revision` en `apps/web/src` (buscador del editor o `grep -rn "en_revision" apps/web/src`).
Expected: solo la línea de `types.ts`. Si `tt(t, 'competitions.en_revision', ...)` era la única
referencia, no hay que tocar el diccionario (la clave es tolerante a ausencia).

- [ ] **Step 4: Tests de render de la web**

Run:
```bash
npm test --workspace=@sports/web
```
Expected: PASS (el test `competitions-index-render` no menciona la etiqueta).

- [ ] **Step 5: Commit (opcional)**

```bash
git add apps/web/src/components/competition/CompetitionsList.tsx apps/web/src/lib/api/types.ts
git commit -m "feat(web): se ocultan las competiciones en revisión, sin etiqueta"
```

---

## Task 12: Web — pestaña "Competiciones" en el panel admin

**Files:**
- Create: `apps/web/src/components/admin/AdminCompetitions.tsx`
- Modify: `apps/web/src/app/[locale]/admin/page.tsx`

- [ ] **Step 1: Crear el componente**

Contenido exacto de `apps/web/src/components/admin/AdminCompetitions.tsx`:

```tsx
'use client';

/**
 * Curación de la calidad de datos (#067): marca competiciones y temporadas
 * como 'ok' (visibles) o 'en_revision' (ocultas para el usuario).
 */

import { useCallback, useEffect, useState } from 'react';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

interface CompRow {
  id: string;
  name: string;
  slug: string;
  data_quality: string;
  archived_at: string | null;
  season_count: string;
  visible_season_count: string;
}

interface SeasonRow {
  id: string;
  name: string;
  slug: string;
  is_current: boolean;
  data_quality: string;
  match_count: string;
}

function QualityButton({
  value, busy, onSet,
}: { value: string; busy: boolean; onSet: (q: 'ok' | 'en_revision') => void }) {
  const hidden = value !== 'ok';
  return (
    <button
      disabled={busy}
      onClick={() => onSet(hidden ? 'ok' : 'en_revision')}
      className={`text-[11px] font-semibold px-2 min-h-[32px] rounded-lg disabled:opacity-40 ${
        hidden
          ? 'text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300'
          : 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400'
      }`}
    >
      {hidden ? 'Oculta · clic para mostrar' : 'Visible · clic para ocultar'}
    </button>
  );
}

export function AdminCompetitions({ token, onError }: { token: string; onError: (m: string) => void }) {
  const [comps, setComps] = useState<CompRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<Record<string, SeasonRow[]>>({});
  const [q, setQ] = useState('');

  const loadComps = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/competitions/quality`, {
        headers: { 'X-Admin-Token': token },
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setComps((await res.json() as { competitions: CompRow[] }).competitions);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [token, onError]);

  const loadSeasons = useCallback(async (compId: string) => {
    try {
      const res = await fetch(`${API_URL}/admin/competitions/${compId}/seasons/quality`, {
        headers: { 'X-Admin-Token': token },
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const body = await res.json() as { seasons: SeasonRow[] };
      setSeasons((s) => ({ ...s, [compId]: body.seasons }));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error');
    }
  }, [token, onError]);

  useEffect(() => { void loadComps(); }, [loadComps]);

  const patch = useCallback(async (path: string, dataQuality: 'ok' | 'en_revision', id: string, after: () => Promise<void>) => {
    setBusy(id);
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ dataQuality }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      await after();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(null);
    }
  }, [token, onError]);

  const toggleOpen = useCallback(async (id: string) => {
    setOpenId((cur) => (cur === id ? null : id));
    if (!seasons[id]) await loadSeasons(id);
  }, [seasons, loadSeasons]);

  const filtered = comps.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar competición…"
        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700
                   bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200
                   focus:outline-none focus:ring-2 focus:ring-rink-passion"
      />
      {loading && <p className="text-sm text-slate-400">Cargando…</p>}

      <div className="card divide-y divide-slate-100 dark:divide-slate-800/60">
        {filtered.map((c) => (
          <div key={c.id}>
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                onClick={() => void toggleOpen(c.id)}
                className="flex-1 text-left min-w-0"
              >
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{c.name}</p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                  {c.slug}
                  {c.archived_at ? ' · archivada' : ''}
                  {` · ${Number(c.visible_season_count)}/${Number(c.season_count)} temporadas visibles`}
                </p>
              </button>
              <QualityButton
                value={c.data_quality}
                busy={busy === c.id}
                onSet={(quality) => void patch(`/admin/competitions/${c.id}/quality`, quality, c.id, loadComps)}
              />
            </div>

            {openId === c.id && (
              <div className="px-4 pb-3 space-y-2">
                {(seasons[c.id] ?? []).map((s) => (
                  <div key={s.id} className="flex items-center gap-3 pl-4">
                    <p className="flex-1 min-w-0 text-xs text-slate-600 dark:text-slate-300 truncate">
                      {s.name}{s.is_current ? ' (actual)' : ''} · {Number(s.match_count)} partidos
                    </p>
                    <QualityButton
                      value={s.data_quality}
                      busy={busy === s.id}
                      onSet={(quality) => void patch(
                        `/admin/seasons/${s.id}/quality`, quality, s.id,
                        () => loadSeasons(c.id),
                      )}
                    />
                  </div>
                ))}
                {(seasons[c.id] ?? []).length === 0 && (
                  <p className="text-xs text-slate-400 pl-4">Sin temporadas</p>
                )}
              </div>
            )}
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-slate-400">Sin competiciones</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Añadir las pestañas al panel**

En `apps/web/src/app/[locale]/admin/page.tsx`:

1. Añadir el import:
```tsx
import { AdminCompetitions } from '@/components/admin/AdminCompetitions';
```
2. Añadir el estado de pestaña junto a los demás `useState`:
```tsx
  const [tab, setTab] = useState<'users' | 'competitions'>('users');
```
3. Tras el botón «Cerrar sesión admin» (dentro del `<div className="flex items-center justify-between">`), añadir una fila de pestañas. Sustituir el bloque del encabezado:
```tsx
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-50">
          {tab === 'users' ? 'Usuarios' : 'Competiciones'}
        </h1>
        <button
          onClick={() => { setData(null); setToken(''); try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* noop */ } }}
          className="text-xs text-slate-400 hover:text-red-500 min-h-[44px] px-2"
        >
          Cerrar sesión admin
        </button>
      </div>

      <div className="flex gap-1">
        {([['users', 'Usuarios'], ['competitions', 'Competiciones']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`text-xs font-semibold px-3 min-h-[36px] rounded-lg ${
              tab === key
                ? 'bg-rink-passion text-white'
                : 'text-slate-500 hover:text-rink-passion'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
```
4. Envolver el bloque de KPIs, error y tabla de usuarios en `{tab === 'users' && (<> … </>)}`. El bloque va desde `{/* KPIs */}` hasta el cierre de la `<div className="card overflow-hidden overflow-x-auto">`. Y añadir al final del contenedor:
```tsx
      {tab === 'competitions' && <AdminCompetitions token={token} onError={setError} />}
```

- [ ] **Step 3: Typecheck y lint de la web**

Run:
```bash
npm run typecheck --workspace=@sports/web
npm run lint --workspace=@sports/web
```
Expected: sin errores.

- [ ] **Step 4: Tests de la web**

Run:
```bash
npm test --workspace=@sports/web
```
Expected: PASS.

- [ ] **Step 5: Commit (opcional)**

```bash
git add apps/web/src/components/admin/AdminCompetitions.tsx "apps/web/src/app/[locale]/admin/page.tsx"
git commit -m "feat(web): pestaña de curación de calidad en el panel admin"
```

---

## Task 13: Documentación

**Files:**
- Modify: `docs/database.md`
- Modify: `docs/RUNBOOK_COMPETICIONES.md`

- [ ] **Step 1: Documentar el modelo en `docs/database.md`**

Buscar la sección de `competitions`/`seasons` y añadir:

```markdown
### Calidad de datos / visibilidad (migraciones 064 y 067)

- `competitions.data_quality` y `seasons.data_quality`: `'ok'` (defecto) | `'en_revision'`.
- **Una temporada es visible ⇔ ella y su competición están en `'ok'`.** Si no,
  deja de ser consultable por el usuario: listados, búsqueda, selector de
  temporadas, endpoints de temporada (`overview`/`stats`/`standings`/`matches`,
  → 404), ficha de partido, historial de equipo, carrera de jugador y sitemap.
- La competición actúa de interruptor maestro: `en_revision` oculta todo su contenido.
- El scraper/ETL **nunca** escribe estas columnas; la curación sobrevive a los upserts.
- Curación: panel `/admin` → pestaña «Competiciones», o los endpoints
  `PATCH /admin/competitions/:id/quality` y `PATCH /admin/seasons/:id/quality`.
- Límite: las páginas web cacheadas por ISR pueden tardar hasta ~5 min en reflejar
  el cambio (la API responde 404 al instante).
```

- [ ] **Step 2: Añadir la sección al runbook**

Al final de `docs/RUNBOOK_COMPETICIONES.md`:

```markdown
## Ocultar competiciones/temporadas por calidad de datos

Cuando una competición o temporada tiene datos que no son de fiar, se oculta en
vez de etiquetarse. Regla: visible ⇔ competición y temporada en `data_quality='ok'`.

1. Entrar en `/admin` (token) → pestaña **Competiciones**.
2. Buscar la competición; el toggle de la fila la oculta entera (interruptor
   maestro). Desplegarla muestra sus temporadas para ocultar solo algunas.
3. Comprobar que desaparece de `/competitions`, de la búsqueda y que su URL
   directa devuelve 404.

Alternativa por API (mismo token):

```bash
curl -X PATCH "$API/admin/seasons/<uuid>/quality" \
  -H "X-Admin-Token: $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"dataQuality":"en_revision"}'
```

Nota: la web revalida cada ~5 min; la API responde 404 al instante.
```

- [ ] **Step 3: Commit (opcional)**

```bash
git add docs/database.md docs/RUNBOOK_COMPETICIONES.md
git commit -m "docs: visibilidad por calidad de competiciones y temporadas"
```

---

## Task 14: Verificación final

**Files:** ninguno (verificación).

- [ ] **Step 1: Typecheck global**

Run:
```bash
npm run typecheck
```
Expected: sin errores.

- [ ] **Step 2: Lint global**

Run:
```bash
npm run lint
```
Expected: sin errores.

- [ ] **Step 3: Tests unitarios globales**

Run:
```bash
npm run test
```
Expected: todo verde.

- [ ] **Step 4: Tests de integración con Postgres real**

Run:
```bash
npm run test:integration:docker
```
Expected: migraciones desde cero, todos los tests verdes, incluido
`tests/integration/visibility-quality.integration.test.ts`.

- [ ] **Step 5: Revisión del diff**

Run:
```bash
git status
git diff --stat
```
Expected: solo los ficheros listados en **File Structure**; sin ficheros temporales,
sin `console.log` de depuración, sin secretos.

- [ ] **Step 6: Comprobación manual en local**

1. Levantar API (`npm run dev --workspace=@sports/api`) y web (`npm run dev --workspace=@sports/web`).
2. En `/admin`, ocultar una competición y una temporada concreta.
3. Verificar: no aparecen en `/competitions` ni en la búsqueda; su URL directa da 404;
   la clasificación/calendario/ficha de partido de la temporada oculta dan 404.
4. Desmarcarlas y comprobar que vuelven.

---

## Self-Review

**Cobertura del spec:**
- Migración e invariantes → Task 1; el upsert no toca `data_quality` (los `INSERT`/`ON CONFLICT` no listan la columna) y se comprueba de facto en los tests de calidad.
- Regla de visibilidad → Tasks 3–9.
- Superficies de la tabla del spec: `/competitions` (T4), `/:id/seasons` (T4), overview/stats/standings/matches (T5), match-detail/stream/live (T6), search (T7), teams/players (T8), sitemap (T9), admin (T10), web (T11–T12), docs (T13).
- `archived_at` intacto: no se modifica.
- Testing (integración + unitarios) → Tasks 2–10.

**Placeholders:** ninguno; todo paso que cambia código muestra el código exacto.

**Consistencia de tipos/nombres:** `DataQuality`, `listCompetitionsForQuality`, `setCompetitionQuality`,
`listSeasonsForQuality`, `setSeasonQuality`, `SEASON_VISIBLE_SQL`, `seasonVisible`,
`CompetitionQualityRow`, `SeasonQualityRow` se definen una vez y se reutilizan con el mismo nombre.
`DbCompetition.data_quality` y `DbSeason.data_quality` se añaden en Task 2 y se usan en Task 10.
