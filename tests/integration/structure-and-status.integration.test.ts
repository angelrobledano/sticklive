/**
 * Estructura explícita de la fuente y estado del partido, de punta a punta en el
 * ETL contra Postgres real:
 *
 *   filas de calendario (StructureRow) → planSourceStructure → applyStructurePlan
 *   → assignStructure → loadMatches → BD
 *
 * y los escenarios del directo a través del MISMO loader que usa producción.
 * Lo que la fuente no dice del estado no lo cambia nadie; la hora no hace LIVE.
 */
import { describe, test, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { planSourceStructure, type ScrapedMatch, type ScrapeResult, type StructureRow } from '@sports/shared-types';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada } from './support/factorias.js';
import { loadMatches } from '../../apps/etl/src/loaders/match.loader.js';
import { applyStructurePlan, assignStructure } from '../../apps/etl/src/structure/apply-structure.js';
import { MissingLiveTracker } from '../../apps/etl/src/missing-live.js';

let sportId: string;
let seasonId: string;
let sourceId: string;

async function fuente(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO data_sources (name, base_url, scraper_key) VALUES ('Fuente test','https://x.invalido/f','fep_hockey')
     ON CONFLICT (scraper_key) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
  return rows[0]!.id;
}

async function equipo(ref: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO teams (sport_id, name, slug, source_id, source_ref) VALUES ($1,$2,$2,$3,$4) RETURNING id`,
    [sportId, `equipo-${ref}`, sourceId, ref]);
  return rows[0]!.id;
}

function scraped(over: Partial<ScrapedMatch>): ScrapedMatch {
  return { seasonId, homeTeamRef: 'H', awayTeamRef: 'A', sourceId, scrapedAt: new Date(), ...over } as ScrapedMatch;
}

function result(items: ScrapedMatch[]): ScrapeResult<ScrapedMatch> {
  return { success: true, data: items, errors: [], durationMs: 1, scraperKey: 'fep_hockey', entityType: 'match' };
}

/** Simula el calendario de una competición: filas con estructura + su partido. */
function calendario(spec: Array<[phaseRef: string, title: string | null, label: string, date: string, home: string, away: string, idp: string]>) {
  return spec.map(([phaseRef, title, label, date, home, away, idp], i) => ({
    structure: { phaseRef, phaseTitle: title, roundLabel: label, date, homeRef: home, awayRef: away, groupName: null, docIndex: i } as StructureRow,
    match: scraped({
      homeTeamRef: home, awayTeamRef: away, sourceRef: `fep_match_${idp}`,
      scheduledAt: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T18:00:00.000Z`,
      roundRef: label, phaseRef,
    }),
  }));
}

async function cargarCalendario(rows: ReturnType<typeof calendario>, declaredKind: 'knockout' | null = null) {
  const plan = planSourceStructure(rows.map((r) => r.structure), { declaredKind });
  const applied = await applyStructurePlan(seasonId, plan, sourceId);
  assignStructure(rows, plan, applied);
  return loadMatches(result(rows.map((r) => r.match!)), sportId);
}

async function estadoDe(idp: string): Promise<string> {
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM matches WHERE source_ref = $1`, [`fep_match_${idp}`]);
  return rows[0]!.status;
}

beforeEach(async () => {
  await limpiar();
  sportId = await crearDeporte();
  sourceId = await fuente();
  const competitionId = await crearCompeticion(sportId);
  seasonId = await crearTemporada(competitionId, { esActual: true });
  for (const r of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']) await equipo(r);
});

afterAll(closeDb);

describe('estructura de la fuente → BD (mismo camino para cualquier formato)', () => {
  test('liga + playoff (series al mejor de N) + playoff de colocación, idempotente', async () => {
    const rows = calendario([
      ['fep_fase_3150', null, 'JORNADA 1', '20251001', '1', '2', '101'],
      ['fep_fase_3150', null, 'JORNADA 2', '20251008', '2', '1', '102'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 CUARTOS', '20260516', '1', '8', '201'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '2 CUARTOS', '20260523', '8', '1', '202'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 SEMIFINALES', '20260529', '1', '4', '203'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 FINAL', '20260612', '1', '3', '204'],
      ['fep_fase_3482', 'PLAY OFF 9 Y 10', 'PARTIDO 1', '20260516', '9', '10', '301'],
      ['fep_fase_3482', 'PLAY OFF 9 Y 10', 'PARTIDO 2', '20260523', '10', '9', '302'],
    ]);
    const r1 = await cargarCalendario(rows);
    expect(r1.upserted).toBe(8);

    const fases = await db.query(`SELECT ordinal, kind, is_placement, resolved_by, source_ref FROM phases WHERE season_id = $1 ORDER BY ordinal`, [seasonId]);
    expect(fases.rows).toEqual([
      { ordinal: 1, kind: 'league', is_placement: false, resolved_by: 'source_rounds', source_ref: 'fep_fase_3150' },
      { ordinal: 2, kind: 'knockout', is_placement: false, resolved_by: 'source_rounds', source_ref: 'fep_fase_3483' },
      { ordinal: 3, kind: 'knockout', is_placement: true, resolved_by: 'source_title', source_ref: 'fep_fase_3482' },
    ]);

    const partidos = await db.query(
      `SELECT m.source_ref, p.source_ref AS fase, r.stage, r.number, m.series_game
         FROM matches m JOIN phases p ON p.id = m.phase_id JOIN rounds r ON r.id = m.round_id
        ORDER BY m.source_ref`);
    expect(partidos.rows).toEqual([
      { source_ref: 'fep_match_101', fase: 'fep_fase_3150', stage: null, number: 1, series_game: null },
      { source_ref: 'fep_match_102', fase: 'fep_fase_3150', stage: null, number: 2, series_game: null },
      { source_ref: 'fep_match_201', fase: 'fep_fase_3483', stage: 'quarters', number: 20, series_game: 1 },
      { source_ref: 'fep_match_202', fase: 'fep_fase_3483', stage: 'quarters', number: 20, series_game: 2 },
      { source_ref: 'fep_match_203', fase: 'fep_fase_3483', stage: 'semis', number: 30, series_game: 1 },
      { source_ref: 'fep_match_204', fase: 'fep_fase_3483', stage: 'final', number: 40, series_game: 1 },
      { source_ref: 'fep_match_301', fase: 'fep_fase_3482', stage: 'placement', number: 60, series_game: 1 },
      { source_ref: 'fep_match_302', fase: 'fep_fase_3482', stage: 'placement', number: 60, series_game: 2 },
    ]);

    // Segunda pasada (el cron horario): mismas filas, mismos ids, nada duplicado.
    const antes = await db.query(`SELECT id FROM rounds ORDER BY id`);
    await cargarCalendario(calendario([
      ['fep_fase_3150', null, 'JORNADA 1', '20251001', '1', '2', '101'],
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 CUARTOS', '20260516', '1', '8', '201'],
    ]));
    const despues = await db.query(`SELECT id FROM rounds ORDER BY id`);
    expect(despues.rows).toEqual(antes.rows);
    expect((await db.query(`SELECT count(*)::int n FROM phases`)).rows[0].n).toBe(3);
  });

  test('final four (solo semis + final) y eliminatoria a doble partido declarada', async () => {
    await cargarCalendario(calendario([
      ['fep_fase_3592', null, 'SEMIFINALES', '20260924', '1', '2', '401'],
      ['fep_fase_3592', null, 'SEMIFINALES', '20260924', '3', '4', '402'],
      ['fep_fase_3592', null, 'FINAL', '20260925', '2', '3', '403'],
    ]));
    const ff = await db.query(`SELECT r.stage, count(*)::int n FROM matches m JOIN rounds r ON r.id = m.round_id GROUP BY r.stage ORDER BY r.stage`);
    expect(ff.rows).toEqual([{ stage: 'final', n: 1 }, { stage: 'semis', n: 2 }]);
  });

  test('una temporada legada (ronda 100) se ADOPTA: los partidos pasan a sus fases explícitas', async () => {
    // Estado de producción antes de 072: playoff entero en la ronda fija 100.
    const r100 = await db.query<{ id: string }>(
      `INSERT INTO rounds (season_id, number, name, round_type) VALUES ($1, 100, 'Playoff por el título', 'playoff') RETURNING id`, [seasonId]);
    const t = await db.query<{ id: string }>(`SELECT id FROM teams WHERE source_ref IN ('1','8') ORDER BY source_ref`);
    await db.query(
      `INSERT INTO matches (season_id, round_id, home_team_id, away_team_id, status, source_ref, scheduled_at)
       VALUES ($1, $2, $3, $4, 'finished', 'fep_match_201', '2026-05-16T18:00:00Z')`,
      [seasonId, r100.rows[0]!.id, t.rows[0]!.id, t.rows[1]!.id]);
    await db.query(`SELECT backfill_legacy_phases()`);
    const legacy = await db.query<{ id: string }>(`SELECT id FROM phases WHERE season_id = $1 AND kind = 'knockout'`, [seasonId]);

    await cargarCalendario(calendario([
      ['fep_fase_3483', 'PLAY OFF OK LIGA', '1 CUARTOS', '20260516', '1', '8', '201'],
    ]));
    const m = await db.query(`SELECT m.phase_id, r.stage, m.series_game, m.status FROM matches m JOIN rounds r ON r.id = m.round_id WHERE m.source_ref = 'fep_match_201'`);
    expect(m.rows[0]).toEqual({ phase_id: legacy.rows[0]!.id, stage: 'quarters', series_game: 1, status: 'finished' });
  });
});

describe('estado del partido a través del loader (directo)', () => {
  async function partido(idp: string, horasDesdeSaque: number) {
    const kickoff = new Date(Date.now() - horasDesdeSaque * 3_600_000).toISOString();
    await loadMatches(result([scraped({ homeTeamRef: '1', awayTeamRef: '2', sourceRef: `fep_match_${idp}`, scheduledAt: kickoff })]), sportId);
    return kickoff;
  }

  test('UPCOMING → LIVE solo con señal explícita del feed; LIVE → FINISHED', async () => {
    const kickoff = await partido('500', -1);
    expect(await estadoDe('500')).toBe('scheduled');
    await loadMatches(result([scraped({ homeTeamRef: '1', awayTeamRef: '2', sourceRef: 'fep_match_500', status: 'live', scheduledAt: kickoff, homeScore: 0, awayScore: 0 })]), sportId, { stampLiveTimes: true });
    expect(await estadoDe('500')).toBe('live');
    await loadMatches(result([scraped({ homeTeamRef: '1', awayTeamRef: '2', sourceRef: 'fep_match_500', status: 'finished', scheduledAt: kickoff, homeScore: 3, awayScore: 1 })]), sportId, { stampLiveTimes: true });
    const fin = await db.query(`SELECT status, home_score, away_score, started_at IS NOT NULL AS empezado, finished_at IS NOT NULL AS terminado FROM matches WHERE source_ref = 'fep_match_500'`);
    expect(fin.rows[0]).toEqual({ status: 'finished', home_score: 3, away_score: 1, empezado: true, terminado: true });
  });

  test('partido que empieza tarde: pasada la hora, el calendario NO lo pone en LIVE', async () => {
    const kickoff = await partido('501', 0.25); // previsto hace 15 min, la fuente aún no lo da en juego
    // Pasada horaria del calendario: fila sin resultado → sin señal de estado.
    await loadMatches(result([scraped({ homeTeamRef: '1', awayTeamRef: '2', sourceRef: 'fep_match_501', scheduledAt: kickoff })]), sportId);
    expect(await estadoDe('501')).toBe('scheduled');
    // Empieza de verdad (feed playing) aunque sea 15 min tarde.
    await loadMatches(result([scraped({ homeTeamRef: '1', awayTeamRef: '2', sourceRef: 'fep_match_501', status: 'live', scheduledAt: kickoff })]), sportId);
    expect(await estadoDe('501')).toBe('live');
  });

  test('partido que aparece ya empezado: el alta nace en LIVE aunque la hora prevista sea futura', async () => {
    const futuro = new Date(Date.now() + 2 * 3_600_000).toISOString(); // p. ej. hora mal publicada
    await loadMatches(result([scraped({ homeTeamRef: '1', awayTeamRef: '2', sourceRef: 'fep_match_502', status: 'live', scheduledAt: futuro, homeScore: 1, awayScore: 0 })]), sportId, { stampLiveTimes: true });
    expect(await estadoDe('502')).toBe('live');
  });

  test('pérdida temporal de datos: filas sin estado no deshacen el LIVE ni su marcador', async () => {
    const kickoff = await partido('503', 0.5);
    await loadMatches(result([scraped({ homeTeamRef: '1', awayTeamRef: '2', sourceRef: 'fep_match_503', status: 'live', scheduledAt: kickoff, homeScore: 2, awayScore: 2 })]), sportId);
    // El calendario horario (sin resultado, sin estado) pasa por encima del directo.
    await loadMatches(result([scraped({ homeTeamRef: '1', awayTeamRef: '2', sourceRef: 'fep_match_503', scheduledAt: kickoff })]), sportId);
    const m = await db.query(`SELECT status, home_score, away_score FROM matches WHERE source_ref = 'fep_match_503'`);
    expect(m.rows[0]).toEqual({ status: 'live', home_score: 2, away_score: 2 });
  });

  test('reinicio del servicio durante un LIVE: el estado vive en la BD y un proceso nuevo no lo finaliza solo', async () => {
    const kickoff = await partido('504', 0.5);
    await loadMatches(result([scraped({ homeTeamRef: '1', awayTeamRef: '2', sourceRef: 'fep_match_504', status: 'live', scheduledAt: kickoff, homeScore: 1, awayScore: 0 })]), sportId);
    // "Reinicio": nuevo tracker de ausencias (estado en memoria perdido).
    const tras = new MissingLiveTracker(3);
    // Primer ciclo tras arrancar: el feed no lo lista (blip) → aún no se finaliza.
    expect(tras.observe(['fep_match_504'], new Set())).toEqual([]);
    expect(await estadoDe('504')).toBe('live');
    // El feed vuelve a listarlo en juego: sigue live, sin depender de nada en memoria.
    await loadMatches(result([scraped({ homeTeamRef: '1', awayTeamRef: '2', sourceRef: 'fep_match_504', status: 'live', scheduledAt: kickoff, homeScore: 2, awayScore: 0 })]), sportId);
    const m = await db.query(`SELECT status, home_score FROM matches WHERE source_ref = 'fep_match_504'`);
    expect(m.rows[0]).toEqual({ status: 'live', home_score: 2 });
  });

  test('partido histórico sin información de directo: el calendario lo da por terminado con su resultado', async () => {
    await loadMatches(result([scraped({ homeTeamRef: '1', awayTeamRef: '2', sourceRef: 'fep_match_505', status: 'finished', scheduledAt: '2019-03-01T18:00:00.000Z', homeScore: 4, awayScore: 4 })]), sportId);
    const m = await db.query(`SELECT status, live_period, live_clock_seconds, started_at IS NULL AS sin_inicio FROM matches WHERE source_ref = 'fep_match_505'`);
    expect(m.rows[0]).toEqual({ status: 'finished', live_period: null, live_clock_seconds: null, sin_inicio: true });
  });
});
