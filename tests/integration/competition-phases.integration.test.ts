/**
 * Fases de competición (migración 072) contra Postgres real:
 *   · identidad de ronda por fase,
 *   · backfill de lo legado (sin reinterpretar lo ambiguo),
 *   · ensurePhase / ensurePhaseRound (idempotentes y adoptando lo legado),
 *   · upsertMatch: una fuente sin señal de estado NO toca el estado.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, ensurePhase, ensurePhaseRound, pruneStalePhases, upsertMatch } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada, crearEquipo, crearFuente } from './support/factorias.js';

beforeEach(limpiar);
afterAll(closeDb);

async function base() {
  const sportId = await crearDeporte();
  const competitionId = await crearCompeticion(sportId);
  const seasonId = await crearTemporada(competitionId);
  const equipos = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((i) => crearEquipo(sportId, `Equipo ${i}`)));
  return { sportId, competitionId, seasonId, equipos };
}

async function ronda(seasonId: string, number: number, name: string, type: string, phaseId: string | null = null) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO rounds (season_id, number, name, round_type, phase_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [seasonId, number, name, type, phaseId],
  );
  return rows[0]!.id;
}

let refN = 0;
async function partido(seasonId: string, home: string, away: string, roundId: string | null, extra: { status?: string } = {}) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO matches (season_id, round_id, home_team_id, away_team_id, status, scheduled_at, source_ref)
     VALUES ($1,$2,$3,$4,$5, NOW(), $6) RETURNING id`,
    [seasonId, roundId, home, away, extra.status ?? 'finished', `fep_match_t${++refN}`],
  );
  return rows[0]!.id;
}

describe('072 — identidad de ronda por fase', () => {
  it('dos fases pueden tener su ronda 1 del mismo tipo', async () => {
    const { seasonId } = await base();
    const titulo = await ensurePhase({ seasonId, sourceRef: 'fep_fase_1', kind: 'knockout', isPlacement: false, name: 'PLAY OFF', ordinal: 2, resolvedBy: 'source_title' });
    const colocacion = await ensurePhase({ seasonId, sourceRef: 'fep_fase_2', kind: 'knockout', isPlacement: true, name: 'PLAY OFF 9 Y 10', ordinal: 3, resolvedBy: 'source_title' });
    await ronda(seasonId, 1, 'X', 'playoff', titulo);
    await expect(ronda(seasonId, 1, 'Y', 'playoff', colocacion)).resolves.toBeTruthy();
  });

  it('sin fase se conserva la unicidad antigua (temporada, número, tipo)', async () => {
    const { seasonId } = await base();
    await ronda(seasonId, 100, 'Playoff', 'playoff');
    await expect(ronda(seasonId, 100, 'Otra', 'playoff')).rejects.toThrow(/uq_rounds_season_phase_number_type/);
  });
});

describe('072 — backfill de temporadas legadas', () => {
  it('liga + playoff legado: fases league y knockout; la ronda 100 queda sin fase eliminatoria (no se inventa)', async () => {
    const { seasonId, equipos: [a, b, c, d] } = await base();
    const j1 = await ronda(seasonId, 1, 'JORNADA 1', 'regular');
    const r100 = await ronda(seasonId, 100, 'Playoff por el título', 'playoff');
    await partido(seasonId, a!, b!, j1);
    await partido(seasonId, c!, d!, r100);
    await partido(seasonId, a!, c!, r100);

    const creadas = await db.query<{ n: number }>(`SELECT backfill_legacy_phases() AS n`);
    expect(creadas.rows[0]!.n).toBe(2);

    const fases = await db.query(`SELECT ordinal, kind, resolved_by FROM phases WHERE season_id = $1 ORDER BY ordinal`, [seasonId]);
    expect(fases.rows).toEqual([
      { ordinal: 1, kind: 'league', resolved_by: 'legacy' },
      { ordinal: 2, kind: 'knockout', resolved_by: 'legacy' },
    ]);
    const r = await db.query(`SELECT r.name, r.stage, p.kind FROM rounds r JOIN phases p ON p.id = r.phase_id WHERE r.season_id = $1 ORDER BY r.number`, [seasonId]);
    expect(r.rows).toEqual([
      { name: 'JORNADA 1', stage: null, kind: 'league' },
      { name: 'Playoff por el título', stage: null, kind: 'knockout' },
    ]);
    const sinFase = await db.query(`SELECT count(*)::int AS n FROM matches WHERE season_id = $1 AND phase_id IS NULL`, [seasonId]);
    expect(sinFase.rows[0].n).toBe(0);

    // Idempotente.
    const otra = await db.query<{ n: number }>(`SELECT backfill_legacy_phases() AS n`);
    expect(otra.rows[0]!.n).toBe(0);
  });

  it('fase eliminatoria SOLO si el nombre es inequívoco y el nº de cruces cuadra', async () => {
    const { seasonId, equipos: [a, b, c, d, e, f] } = await base();
    const semis = await ronda(seasonId, 1, 'SEMIFINALES', 'playoff');
    const final = await ronda(seasonId, 2, 'FINAL', 'playoff');
    // "FINAL" con todo el cuadro dentro (bug antiguo del scraper): 3 cruces.
    const finalSucia = await ronda(seasonId, 4, 'FINAL ', 'cup');
    await partido(seasonId, a!, b!, semis);
    await partido(seasonId, c!, d!, semis);
    await partido(seasonId, a!, c!, final);
    await partido(seasonId, a!, b!, finalSucia);
    await partido(seasonId, c!, d!, finalSucia);
    await partido(seasonId, e!, f!, finalSucia);

    await db.query(`SELECT backfill_legacy_phases()`);
    const r = await db.query(`SELECT number, stage FROM rounds WHERE season_id = $1 ORDER BY number`, [seasonId]);
    expect(r.rows).toEqual([
      { number: 1, stage: 'semis' },
      { number: 2, stage: 'final' },
      { number: 4, stage: null },
    ]);
  });

  it('partidos sin ronda de una competición declarada eliminatoria → fase knockout', async () => {
    const { competitionId, seasonId, equipos: [a, b] } = await base();
    const sourceId = await crearFuente();
    await db.query(
      `INSERT INTO competition_sources (competition_id, source_id, external_ids) VALUES ($1, $2, '{"format":"bracket"}')`,
      [competitionId, sourceId],
    );
    await partido(seasonId, a!, b!, null);
    await partido(seasonId, b!, a!, null);
    await db.query(`SELECT backfill_legacy_phases()`);
    const r = await db.query(`SELECT p.kind FROM matches m JOIN phases p ON p.id = m.phase_id WHERE m.season_id = $1`, [seasonId]);
    expect(r.rows.map((x) => x.kind)).toEqual(['knockout', 'knockout']);
  });
});

describe('ensurePhase / ensurePhaseRound', () => {
  it('idempotentes por referencia de la fuente', async () => {
    const { seasonId } = await base();
    const input = { seasonId, sourceRef: 'fep_fase_3483', kind: 'knockout' as const, isPlacement: false, name: 'PLAY OFF OK LIGA', ordinal: 2, resolvedBy: 'source_rounds' as const };
    const p1 = await ensurePhase(input);
    const p2 = await ensurePhase({ ...input, name: 'PLAY OFF OK LIGA 2026' });
    expect(p2).toBe(p1);
    const r1 = await ensurePhaseRound({ seasonId, phaseId: p1, roundType: 'playoff', number: 20, stage: 'quarters', name: 'CUARTOS' });
    const r2 = await ensurePhaseRound({ seasonId, phaseId: p1, roundType: 'playoff', number: 20, stage: 'quarters', name: 'CUARTOS' });
    expect(r2).toBe(r1);
    const n = await db.query(`SELECT count(*)::int AS n FROM phases WHERE season_id = $1`, [seasonId]);
    expect(n.rows[0].n).toBe(1);
  });

  it('la primera carga estructurada ADOPTA la fase y las rondas legadas (sin huérfanas)', async () => {
    const { seasonId, equipos: [a, b, c, d] } = await base();
    const semis = await ronda(seasonId, 1, 'SEMIFINALES', 'playoff');
    await partido(seasonId, a!, b!, semis);
    await partido(seasonId, c!, d!, semis);
    await db.query(`SELECT backfill_legacy_phases()`);
    const legacy = await db.query<{ id: string }>(`SELECT id FROM phases WHERE season_id = $1`, [seasonId]);

    const phaseId = await ensurePhase({ seasonId, sourceRef: 'fep_fase_3592', kind: 'knockout', isPlacement: false, name: null, ordinal: 1, resolvedBy: 'source_rounds' });
    expect(phaseId).toBe(legacy.rows[0]!.id);
    // El plan numera la semifinal como 30: se adopta la ronda legada por su fase eliminatoria.
    const roundId = await ensurePhaseRound({ seasonId, phaseId, roundType: 'playoff', number: 30, stage: 'semis', name: 'SEMIFINALES' });
    expect(roundId).toBe(semis);
    const finalId = await ensurePhaseRound({ seasonId, phaseId, roundType: 'playoff', number: 40, stage: 'final', name: 'FINAL' });
    expect(finalId).not.toBe(semis);
    const total = await db.query(`SELECT count(*)::int AS n FROM rounds WHERE season_id = $1`, [seasonId]);
    expect(total.rows[0].n).toBe(2);
  });

  it('una liga se adopta aunque la fuente la clasifique como grupos', async () => {
    const { seasonId, equipos: [a, b] } = await base();
    const j1 = await ronda(seasonId, 1, 'Jornada 1', 'regular');
    await partido(seasonId, a!, b!, j1);
    await db.query(`SELECT backfill_legacy_phases()`);
    const legacy = await db.query<{ id: string }>(`SELECT id FROM phases WHERE season_id = $1`, [seasonId]);
    const phaseId = await ensurePhase({ seasonId, sourceRef: 'wse_fase_325', kind: 'groups', isPlacement: false, name: 'GROUP PHASE', ordinal: 1, resolvedBy: 'source_title' });
    expect(phaseId).toBe(legacy.rows[0]!.id);
    const r = await ensurePhaseRound({ seasonId, phaseId, roundType: 'regular', number: 1, stage: null, name: null });
    expect(r).toBe(j1);
  });
});

describe('pruneStalePhases — fases que la fuente ya no publica', () => {
  it('Coppa Italia: los gironi B/C/D, antes eliminatorias y ya vacíos, se retiran; la fase de grupos y las fases con datos se quedan', async () => {
    const { seasonId, equipos: [a, b] } = await base();
    const mk = (ref: string, kind: 'groups' | 'knockout') =>
      ensurePhase({ seasonId, sourceRef: ref, kind, isPlacement: false, name: ref, ordinal: 1, resolvedBy: 'declared' });
    const grupos = await mk('fisr_A', 'groups');
    const viejaB = await mk('fisr_B', 'knockout');
    await ensurePhaseRound({ seasonId, phaseId: viejaB, roundType: 'playoff', number: 90, stage: null, name: 'GIRONE B' });
    const conPartido = await mk('fisr_X', 'knockout');
    const rX = await ensurePhaseRound({ seasonId, phaseId: conPartido, roundType: 'playoff', number: 90, stage: null, name: 'X' });
    await partido(seasonId, a!, b!, rX);
    const conTabla = await mk('fisr_T', 'knockout');
    await db.query(`INSERT INTO standings (season_id, team_id, phase_id, position, played, points) VALUES ($1, $2, $3, 1, 0, 0)`, [seasonId, a, conTabla]);

    const retiradas = await pruneStalePhases(seasonId, [grupos]);
    expect(retiradas).toBe(1);
    const quedan = await db.query<{ source_ref: string }>(`SELECT source_ref FROM phases WHERE season_id = $1 ORDER BY source_ref`, [seasonId]);
    expect(quedan.rows.map((r) => r.source_ref)).toEqual(['fisr_A', 'fisr_T', 'fisr_X']);
  });
});

describe('upsertMatch — el estado solo lo cambia quien lo observa', () => {
  async function escenario() {
    const { seasonId, equipos: [a, b] } = await base();
    return { seasonId, homeTeamId: a!, awayTeamId: b! };
  }

  it('alta sin señal de estado → scheduled', async () => {
    const e = await escenario();
    const m = await upsertMatch({ ...e, sourceRef: 'fep_match_1', scheduledAt: new Date() });
    expect(m.status).toBe('scheduled');
  });

  it('una fila sin señal (calendario sin resultado) NO deshace un live del feed', async () => {
    const e = await escenario();
    await upsertMatch({ ...e, sourceRef: 'fep_match_2', status: 'live', homeScore: 1, awayScore: 0 });
    const m = await upsertMatch({ ...e, sourceRef: 'fep_match_2', scheduledAt: new Date() });
    expect(m.status).toBe('live');
    expect([m.home_score, m.away_score]).toEqual([1, 0]);
  });

  it('una señal explícita sí cambia el estado', async () => {
    const e = await escenario();
    await upsertMatch({ ...e, sourceRef: 'fep_match_3', status: 'live' });
    const m = await upsertMatch({ ...e, sourceRef: 'fep_match_3', status: 'finished', homeScore: 3, awayScore: 2 });
    expect(m.status).toBe('finished');
  });

  it('fase y nº de partido de serie se guardan y se conservan si no vienen', async () => {
    const e = await escenario();
    const phaseId = await ensurePhase({ seasonId: e.seasonId, sourceRef: 'fep_fase_9', kind: 'knockout', isPlacement: false, name: null, ordinal: 1, resolvedBy: 'source_rounds' });
    await upsertMatch({ ...e, sourceRef: 'fep_match_4', phaseId, seriesGame: 2 });
    const m = await upsertMatch({ ...e, sourceRef: 'fep_match_4', status: 'live' });
    expect(m.phase_id).toBe(phaseId);
    expect(m.series_game).toBe(2);
  });
});
