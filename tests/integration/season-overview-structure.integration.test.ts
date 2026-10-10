/**
 * GET /seasons/:id/overview con la estructura explícita, de punta a punta:
 *
 *   filas de calendario → planSourceStructure → applyStructurePlan →
 *   loadMatches → BD → ruta de la API
 *
 * Casos A–F del modelo (liga; liga + playoff; grupos; grupos + final four;
 * solo final four; eliminatoria) salen del MISMO camino, sin lógica por
 * competición. Y una temporada HEREDADA (backfill 072) se sigue viendo como
 * antes hasta que se re-scrapea, momento en que su estructura pasa a explícita.
 */
import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { planSourceStructure, type ScrapedMatch, type ScrapeResult, type StructureRow } from '@sports/shared-types';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada } from './support/factorias.js';
import { loadMatches } from '../../apps/etl/src/loaders/match.loader.js';
import { applyStructurePlan, assignStructure, pruneAfterLoad } from '../../apps/etl/src/structure/apply-structure.js';
import { seasonOverviewRouter } from '../../apps/api/src/routes/season-overview.js';

let sportId: string;
let seasonId: string;
let sourceId: string;
const teamIds = new Map<string, string>();

async function fuente(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO data_sources (name, base_url, scraper_key) VALUES ('Fuente test','https://x.invalido/f','fep_hockey')
     ON CONFLICT (scraper_key) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
  return rows[0]!.id;
}

async function equipo(ref: string): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO teams (sport_id, name, slug, source_id, source_ref) VALUES ($1,$2,$2,$3,$4) RETURNING id`,
    [sportId, `equipo-${ref}`, sourceId, ref]);
  teamIds.set(ref, rows[0]!.id);
}

type Fila = [phaseRef: string, title: string | null, label: string, date: string, home: string | null, away: string | null, idp: string | null];

/** Calendario de la fuente: una fila por partido (equipos null = aún por decidir). */
function calendario(spec: Fila[], grupo: (i: number) => string | null = () => null) {
  return spec.map(([phaseRef, title, label, date, home, away, idp], i) => ({
    structure: { phaseRef, phaseTitle: title, roundLabel: label, date, homeRef: home, awayRef: away, groupName: grupo(i), docIndex: i } as StructureRow,
    match: home && away && idp ? {
      seasonId, sourceId, scrapedAt: new Date(),
      homeTeamRef: home, awayTeamRef: away, sourceRef: `fep_match_${idp}`,
      scheduledAt: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T18:00:00.000Z`,
      roundRef: label, phaseRef,
    } as ScrapedMatch : null,
  }));
}

async function cargar(rows: ReturnType<typeof calendario>) {
  const plan = planSourceStructure(rows.map((r) => r.structure));
  const applied = await applyStructurePlan(seasonId, plan, sourceId);
  assignStructure(rows, plan, applied);
  const data = rows.map((r) => r.match).filter((m): m is ScrapedMatch => m !== null);
  const res: ScrapeResult<ScrapedMatch> = { success: true, data, errors: [], durationMs: 1, scraperKey: 'fep_hockey', entityType: 'match' };
  await loadMatches(res, sportId);
  await pruneAfterLoad(seasonId, applied);
}

async function clasificacion(...refs: string[]) {
  for (const [i, ref] of refs.entries()) {
    await db.query(`INSERT INTO standings (season_id, team_id, position, played, points) VALUES ($1,$2,$3,1,3)`,
      [seasonId, teamIds.get(ref), i + 1]);
  }
}

interface OverviewMatch { id: string; roundNumber: number | null; roundType: string; stage: string | null; seriesGame: number | null; stageInferred: boolean; phaseId: string | null; homeTeam: { name: string } }
interface Overview {
  season: { competitionFormat: string; phases: Array<{ id: string; kind: string; isPlacement: boolean; hasStandings: boolean; stages: string[]; stagesInferred: boolean }> };
  rounds: Array<{ id: string; number: number; phaseId: string | null; stage: string | null }>;
  matches: OverviewMatch[];
}

async function overview(): Promise<Overview> {
  const res = await seasonOverviewRouter.request(`/${seasonId}/overview`);
  expect(res.status).toBe(200);
  return (await res.json()) as Overview;
}

/** Partido del payload por su idp de la fuente. */
async function porIdp(o: Overview, idp: string): Promise<OverviewMatch> {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM matches WHERE source_ref = $1`, [`fep_match_${idp}`]);
  return o.matches.find((m) => m.id === rows[0]!.id)!;
}

const fases = (o: Overview) => o.season.phases.map((p) => [p.kind, p.isPlacement, p.hasStandings, p.stages]);

beforeEach(async () => {
  await limpiar();
  teamIds.clear();
  sportId = await crearDeporte();
  sourceId = await fuente();
  seasonId = await crearTemporada(await crearCompeticion(sportId), { esActual: true });
  for (let i = 1; i <= 10; i++) await equipo(String(i));
});

afterAll(closeDb);

describe('overview: casos A–F desde el mismo modelo', () => {
  test('A — liga regular', async () => {
    await cargar(calendario([
      ['fep_fase_1', null, 'JORNADA 1', '20251001', '1', '2', '1'],
      ['fep_fase_1', null, 'JORNADA 2', '20251008', '2', '3', '2'],
    ]));
    await clasificacion('1', '2');
    const o = await overview();
    expect(o.season.competitionFormat).toBe('league');
    expect(fases(o)).toEqual([['league', false, true, []]]);
    expect([await porIdp(o, '1'), await porIdp(o, '2')].map((m) => [m.roundType, m.roundNumber, m.stage])).toEqual([
      ['regular', 1, null], ['regular', 2, null],
    ]);
  });

  test('B — liga + playoff (QF→SF→F, series) + colocación 9.º-10.º', async () => {
    await cargar(calendario([
      ['fep_fase_3150', null, 'JORNADA 1', '20251001', '1', '2', '101'],
      ['fep_fase_3150', null, 'JORNADA 1', '20251001', '3', '4', '102'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 CUARTOS', '20260516', '1', '8', '201'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '2 CUARTOS', '20260523', '8', '1', '202'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 SEMIFINALES', '20260529', '1', '4', '203'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 FINAL', '20260612', '1', '3', '204'],
      ['fep_fase_3482', 'PLAY OFF 9 Y 10', 'PARTIDO 1', '20260516', '9', '10', '301'],
    ]));
    await clasificacion('1', '2');
    const o = await overview();
    expect(o.season.competitionFormat).toBe('league');
    expect(fases(o)).toEqual([
      ['league', false, true, []],
      ['knockout', false, false, ['quarters', 'semis', 'final']],
      ['knockout', true, false, ['placement']],
    ]);
    const vista = await Promise.all(['201', '202', '203', '204', '301'].map((i) => porIdp(o, i)));
    expect(vista.map((m) => [m.stage, m.seriesGame, m.roundNumber, m.roundType, m.stageInferred])).toEqual([
      ['quarters', 1, 1, 'playoff', false],
      ['quarters', 2, 1, 'playoff', false],
      ['semis', 1, 2, 'playoff', false],
      ['final', 1, 3, 'playoff', false],
      ['placement', 1, 0, 'playoff', false],
    ]);
  });

  test('C — grupos (bloques "GRUPO A/B" de una misma fase)', async () => {
    await cargar(calendario([
      ['wse_fase_1', 'GRUPO A', 'JORNADA 1', '20261005', '1', '2', '1'],
      ['wse_fase_2', 'GRUPO B', 'JORNADA 1', '20261005', '3', '4', '2'],
    ]));
    await clasificacion('1', '2', '3', '4');
    const o = await overview();
    expect(fases(o)).toEqual([['groups', false, true, []]]);
    expect(o.season.competitionFormat).toBe('league');
  });

  test('D — grupos + final four: clasificación Y cuadro', async () => {
    await cargar(calendario([
      ['wse_fase_1', 'GRUPO A', 'JORNADA 1', '20261005', '1', '2', '1'],
      ['wse_fase_2', 'GRUPO B', 'JORNADA 1', '20261005', '3', '4', '2'],
      ['wse_fase_9', 'FINAL FOUR', 'SEMIFINALES', '20261010', '1', '4', '3'],
      ['wse_fase_9', 'FINAL FOUR', 'SEMIFINALES', '20261010', '3', '2', '4'],
      ['wse_fase_9', 'FINAL FOUR', 'FINAL', '20261011', null, null, null],
    ]));
    await clasificacion('1', '2', '3', '4');
    const o = await overview();
    expect(fases(o)).toEqual([
      ['groups', false, true, []],
      ['knockout', false, false, ['semis', 'final']],
    ]);
    expect(o.season.competitionFormat).toBe('league');
  });

  test('E — solo final four (la final aún sin equipos sigue en la estructura)', async () => {
    await cargar(calendario([
      ['fep_fase_7', 'SUPERCOPA', 'SEMIFINAL', '20260924', '1', '2', '1'],
      ['fep_fase_7', 'SUPERCOPA', 'SEMIFINAL', '20260924', '3', '4', '2'],
      ['fep_fase_7', 'SUPERCOPA', 'FINAL', '20260925', null, null, null],
    ]));
    const o = await overview();
    expect(o.season.competitionFormat).toBe('final_four');
    expect(fases(o)).toEqual([['knockout', false, false, ['semis', 'final']]]);
    // Las dos semis son semis (antes la segunda se etiquetaba como final).
    expect((await porIdp(o, '2')).roundNumber).toBe(2);
    expect(o.rounds.some((r) => r.stage === 'final')).toBe(true);
  });

  test('F — eliminatoria cuartos → semis → final', async () => {
    await cargar(calendario([
      ['fep_fase_8', null, 'CUARTOS DE FINAL', '20260319', '1', '8', '1'],
      ['fep_fase_8', null, 'CUARTOS DE FINAL', '20260319', '2', '7', '2'],
      ['fep_fase_8', null, 'CUARTOS DE FINAL', '20260319', '3', '6', '3'],
      ['fep_fase_8', null, 'CUARTOS DE FINAL', '20260319', '4', '5', '4'],
      ['fep_fase_8', null, 'SEMIFINALES', '20260321', '1', '4', '5'],
      ['fep_fase_8', null, 'SEMIFINALES', '20260321', '2', '3', '6'],
      ['fep_fase_8', null, 'FINAL', '20260322', '1', '2', '7'],
    ]));
    const o = await overview();
    expect(o.season.competitionFormat).toBe('bracket');
    expect(fases(o)).toEqual([['knockout', false, false, ['quarters', 'semis', 'final']]]);
    const vista = await Promise.all(['1', '4', '5', '6', '7'].map((i) => porIdp(o, i)));
    expect(vista.map((m) => m.stage)).toEqual(['quarters', 'quarters', 'semis', 'semis', 'final']);
  });
});

describe('overview: temporada heredada → re-scrape', () => {
  test('el playoff legado (ronda 100) se ve como antes y, al re-scrapear, pasa a estructura explícita sin perder partidos', async () => {
    // Datos de antes de 072: jornada + playoff entero en la ronda 100.
    const ronda = async (n: number, name: string, type: string) => (await db.query<{ id: string }>(
      `INSERT INTO rounds (season_id, number, name, round_type) VALUES ($1,$2,$3,$4) RETURNING id`,
      [seasonId, n, name, type])).rows[0]!.id;
    const j1 = await ronda(1, 'JORNADA 1', 'regular');
    const r100 = await ronda(100, 'Playoff por el título', 'playoff');
    const legado: Array<[string, string, string, string, string]> = [
      ['101', '1', '2', '2025-10-01', j1], ['102', '3', '4', '2025-10-01', j1],
      ['201', '1', '8', '2026-05-16', r100], ['202', '2', '7', '2026-05-16', r100],
      ['203', '3', '6', '2026-05-17', r100], ['204', '4', '5', '2026-05-17', r100],
      ['205', '1', '4', '2026-05-29', r100], ['206', '2', '3', '2026-05-30', r100],
      ['207', '1', '2', '2026-06-12', r100],
    ];
    for (const [idp, h, a, date, round] of legado) {
      await db.query(
        `INSERT INTO matches (season_id, round_id, home_team_id, away_team_id, status, scheduled_at, source_id, source_ref)
         VALUES ($1,$2,$3,$4,'finished',$5,$6,$7)`,
        [seasonId, round, teamIds.get(h), teamIds.get(a), `${date}T18:00:00Z`, sourceId, `fep_match_${idp}`]);
    }
    await db.query(`SELECT backfill_legacy_phases()`);

    const antes = await overview();
    const final0 = await porIdp(antes, '207');
    expect(final0).toMatchObject({ stage: 'final', roundNumber: 3, stageInferred: true });
    expect((await porIdp(antes, '205')).roundNumber).toBe(2);
    expect(antes.season.phases.find((p) => p.kind === 'knockout')).toMatchObject({ stagesInferred: true });

    // Re-scrape de la fuente con su estructura explícita.
    await cargar(calendario([
      ['fep_fase_3150', null, 'JORNADA 1', '20251001', '1', '2', '101'],
      ['fep_fase_3150', null, 'JORNADA 1', '20251001', '3', '4', '102'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 CUARTOS', '20260516', '1', '8', '201'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 CUARTOS', '20260516', '2', '7', '202'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 CUARTOS', '20260517', '3', '6', '203'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 CUARTOS', '20260517', '4', '5', '204'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 SEMIFINALES', '20260529', '1', '4', '205'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 SEMIFINALES', '20260530', '2', '3', '206'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 FINAL', '20260612', '1', '2', '207'],
    ]));

    const despues = await overview();
    // Mismos partidos (mismos ids), ahora con fase explícita y sin deducción.
    expect(despues.matches.map((m) => m.id).sort()).toEqual(antes.matches.map((m) => m.id).sort());
    expect((await porIdp(despues, '207'))).toMatchObject({ id: final0.id, stage: 'final', roundNumber: 3, stageInferred: false });
    expect(despues.season.phases.map((p) => [p.kind, p.stages, p.stagesInferred])).toEqual([
      ['league', [], false],
      ['knockout', ['quarters', 'semis', 'final'], false],
    ]);
    // La ronda 100, ya vacía, no se expone (y el ETL la ha retirado).
    expect(despues.rounds.some((r) => r.number === 100)).toBe(false);
    const r100Existe = await db.query(`SELECT 1 FROM rounds WHERE id = $1`, [r100]);
    expect(r100Existe.rowCount).toBe(0);
    const fasesBd = await db.query(`SELECT count(*)::int AS n FROM phases WHERE season_id = $1`, [seasonId]);
    expect(fasesBd.rows[0]!.n).toBe(2); // adoptadas, no duplicadas
  });
});
