/**
 * A7 — la clasificación pertenece a una FASE, no solo a la temporada.
 *
 * Hasta ahora `standings` era única por (temporada, equipo, grupo) y la API la
 * atribuía a la primera liguilla por título. Con dos liguillas seguidas (fase
 * regular + segunda fase por grupos, frecuente en base y en FECAPA) la segunda
 * PISABA a la primera. Con `phase_id` conviven.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, ensurePhase, upsertStanding, findPhaseIdByTitle, getStandings } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada, crearEquipo } from './support/factorias.js';

beforeEach(limpiar);

const C = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
afterAll(closeDb);

describe('A7 — standings.phase_id', () => {
  it('dos fases de liguilla guardan clasificaciones distintas del mismo equipo', async () => {
    const sportId = await crearDeporte();
    const season = await crearTemporada(await crearCompeticion(sportId));
    const team = await crearEquipo(sportId, 'IGUALADA');
    const f1 = await ensurePhase({ seasonId: season, sourceRef: 'fecapa_fase_1', kind: 'league', isPlacement: false, name: 'FEM 17 PLATA 1', ordinal: 1, resolvedBy: 'source_title' });
    const f2 = await ensurePhase({ seasonId: season, sourceRef: 'fecapa_fase_2', kind: 'league', isPlacement: false, name: 'FEM 17 PLATA 2', ordinal: 2, resolvedBy: 'source_title' });

    await upsertStanding({ ...C, seasonId: season, teamId: team, phaseId: f1, position: 1, points: 30 });
    await upsertStanding({ ...C, seasonId: season, teamId: team, phaseId: f2, position: 4, points: 9 });

    const rows = await db.query(`SELECT phase_id, position, points FROM standings WHERE team_id = $1 ORDER BY position`, [team]);
    expect(rows.rows).toEqual([
      { phase_id: f1, position: 1, points: 30 },
      { phase_id: f2, position: 4, points: 9 },
    ]);
  });

  it('sin fase se comporta como antes (upsert sobre la misma fila)', async () => {
    const sportId = await crearDeporte();
    const season = await crearTemporada(await crearCompeticion(sportId));
    const team = await crearEquipo(sportId, 'A');
    await upsertStanding({ ...C, seasonId: season, teamId: team, position: 2 });
    await upsertStanding({ ...C, seasonId: season, teamId: team, position: 1 });
    const rows = await db.query(`SELECT position FROM standings WHERE team_id = $1`, [team]);
    expect(rows.rows).toEqual([{ position: 1 }]);
  });

  it('la fase se encuentra por el título de la tabla (sin distinguir mayúsculas ni espacios)', async () => {
    const sportId = await crearDeporte();
    const season = await crearTemporada(await crearCompeticion(sportId));
    const f = await ensurePhase({ seasonId: season, sourceRef: 'fep_fase_9', kind: 'groups', isPlacement: false, name: 'FASE DE GRUPS FRIT RAVICH LLIGA CATALANA', ordinal: 1, resolvedBy: 'source_title' });
    await expect(findPhaseIdByTitle(season, '  fase de grups frit ravich lliga catalana ')).resolves.toBe(f);
    await expect(findPhaseIdByTitle(season, 'OTRA')).resolves.toBeNull();
    await expect(findPhaseIdByTitle(season, undefined)).resolves.toBeNull();
  });
});

describe('A7 — transición desde las filas sin fase', () => {
  it('la primera escritura con fase adopta la fila legada en vez de duplicarla', async () => {
    const sportId = await crearDeporte();
    const season = await crearTemporada(await crearCompeticion(sportId));
    const team = await crearEquipo(sportId, 'A');
    const f = await ensurePhase({ seasonId: season, sourceRef: 'fep_fase_1', kind: 'league', isPlacement: false, name: 'LIGA', ordinal: 1, resolvedBy: 'source_title' });
    await upsertStanding({ ...C, seasonId: season, teamId: team, position: 3 });
    await upsertStanding({ ...C, seasonId: season, teamId: team, phaseId: f, position: 2 });
    const rows = await db.query(`SELECT phase_id, position FROM standings WHERE team_id = $1`, [team]);
    expect(rows.rows).toEqual([{ phase_id: f, position: 2 }]);
  });

  it('getStandings devuelve la tabla de la ÚLTIMA fase si hay varias (como antes, cuando la pisaba)', async () => {
    const sportId = await crearDeporte();
    const season = await crearTemporada(await crearCompeticion(sportId));
    const team = await crearEquipo(sportId, 'A');
    const f1 = await ensurePhase({ seasonId: season, sourceRef: 'x1', kind: 'league', isPlacement: false, name: 'F1', ordinal: 1, resolvedBy: 'source_title' });
    const f2 = await ensurePhase({ seasonId: season, sourceRef: 'x2', kind: 'league', isPlacement: false, name: 'F2', ordinal: 2, resolvedBy: 'source_title' });
    await upsertStanding({ ...C, seasonId: season, teamId: team, phaseId: f1, position: 1 });
    await upsertStanding({ ...C, seasonId: season, teamId: team, phaseId: f2, position: 5 });
    const rows = await getStandings(season);
    expect(rows.map((r) => r.position)).toEqual([5]);
    const primera = await getStandings(season, undefined, f1);
    expect(primera.map((r) => r.position)).toEqual([1]);
  });
});

describe('A7 — loadStandings con dos liguillas', () => {
  it('cargar la segunda fase no borra la tabla de la primera', async () => {
    const { loadStandings } = await import('../../apps/etl/src/loaders/standing.loader.js');
    const sportId = await crearDeporte();
    const season = await crearTemporada(await crearCompeticion(sportId));
    const [a, b, c] = [await crearEquipo(sportId, 'EQUIPO A'), await crearEquipo(sportId, 'EQUIPO B'), await crearEquipo(sportId, 'EQUIPO C')];
    await db.query(`INSERT INTO season_teams (season_id, team_id) VALUES ($1,$2),($1,$3),($1,$4)`, [season, a, b, c]);
    const f1 = await ensurePhase({ seasonId: season, sourceRef: 'p1', kind: 'league', isPlacement: false, name: 'PRIMERA FASE', ordinal: 1, resolvedBy: 'source_title' });
    const f2 = await ensurePhase({ seasonId: season, sourceRef: 'p2', kind: 'league', isPlacement: false, name: 'SEGUNDA FASE', ordinal: 2, resolvedBy: 'source_title' });
    const fila = (teamRef: string, phaseTitle: string, position: number) => ({
      teamRef, phaseTitle, position, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 1, goalsAgainst: 0, points: 3,
      sourceId: undefined, sourceRef: undefined, sourceUrl: 'x', scrapedAt: new Date().toISOString(),
    });
    const meta = { success: true, errors: [], durationMs: 0, scraperKey: 'fep_hockey', entityType: 'standing' };
    // Primera pasada: solo la primera fase. Segunda: la fuente ya solo publica
    // la segunda. La limpieza de residuos no debe tocar la tabla de otra fase.
    await loadStandings({ ...meta, data: [
      fila('EQUIPO A', 'PRIMERA FASE', 1), fila('EQUIPO B', 'PRIMERA FASE', 2), fila('EQUIPO C', 'PRIMERA FASE', 3),
    ] } as never, sportId, season);
    await loadStandings({ data: [
      fila('EQUIPO A', 'SEGUNDA FASE', 1), fila('EQUIPO B', 'SEGUNDA FASE', 2),
    ], success: true, errors: [], durationMs: 0, scraperKey: 'fep_hockey', entityType: 'standing' } as never, sportId, season);
    const rows = await db.query<{ phase_id: string; n: number }>(
      `SELECT phase_id, count(*)::int AS n FROM standings WHERE season_id = $1 GROUP BY phase_id ORDER BY n DESC`, [season]);
    expect(rows.rows).toEqual([{ phase_id: f1, n: 3 }, { phase_id: f2, n: 2 }]);
  });
});
