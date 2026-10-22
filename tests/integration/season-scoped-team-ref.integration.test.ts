/**
 * A5 — la ref de inscripción de sidgad (`teamId`) es de UNA temporada.
 *
 * El `teamId` cambia por temporada y competición (2.371 ids para 310 clubes
 * en el catálogo FECAPA/RFEP/WS) y cada portal numera aparte: la ref `1450`
 * es C.E. NOIA en un portal y CH CASTELLAR en otro (#228). Guardada en
 * `teams.alt_source_refs` es global y ambigua. Guardada en `season_teams`
 * (temporada → un solo portal) es determinista.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, recordSeasonTeamRef } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada } from './support/factorias.js';
import { RefResolver } from '../../apps/etl/src/loaders/ref-resolver.js';

beforeEach(limpiar);
afterAll(closeDb);

async function equipo(sportId: string, name: string, ref: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO teams (sport_id, name, slug, source_ref) VALUES ($1,$2,$2,$3) RETURNING id`,
    [sportId, name, ref]);
  return rows[0]!.id;
}

describe('A5 — ref de inscripción por temporada', () => {
  it('con la temporada, una ref ambigua entre portales resuelve el equipo de ESA temporada', async () => {
    const sportId = await crearDeporte();
    const noia = await equipo(sportId, 'C.E. NOIA', '1450');
    await equipo(sportId, 'CH CASTELLAR', '1450');
    const season = await crearTemporada(await crearCompeticion(sportId));
    await recordSeasonTeamRef(season, noia, '1450');

    const r = new RefResolver(sportId);
    await expect(r.resolveTeam('1450', undefined, undefined, season)).resolves.toBe(noia);
  });

  it('la misma ref en otra temporada puede ser otro equipo', async () => {
    const sportId = await crearDeporte();
    const a = await equipo(sportId, 'A', 'x-a');
    const b = await equipo(sportId, 'B', 'x-b');
    const comp = await crearCompeticion(sportId);
    const s1 = await crearTemporada(comp);
    const s2 = await crearTemporada(comp, { esActual: false });
    await recordSeasonTeamRef(s1, a, '3408');
    await recordSeasonTeamRef(s2, b, '3408');
    const r = new RefResolver(sportId);
    await expect(r.resolveTeam('3408', undefined, undefined, s1)).resolves.toBe(a);
    await expect(r.resolveTeam('3408', undefined, undefined, s2)).resolves.toBe(b);
  });

  it('una ref ya registrada para otro equipo en la temporada no se pisa', async () => {
    const sportId = await crearDeporte();
    const a = await equipo(sportId, 'A', 'y-a');
    const b = await equipo(sportId, 'B', 'y-b');
    const s = await crearTemporada(await crearCompeticion(sportId));
    await recordSeasonTeamRef(s, a, '77');
    await expect(recordSeasonTeamRef(s, b, '77')).resolves.toBe(false);
    const rows = await db.query(`SELECT team_id FROM season_teams WHERE season_id = $1 AND source_ref = '77'`, [s]);
    expect(rows.rows).toEqual([{ team_id: a }]);
  });
});

describe('A5 — el resolver aprende la ref de inscripción', () => {
  it('al resolver por el puente con temporada, la ref queda en season_teams', async () => {
    const sportId = await crearDeporte();
    const t = await equipo(sportId, 'IGUALADA', '3408');
    const s = await crearTemporada(await crearCompeticion(sportId));
    const r = new RefResolver(sportId);
    await expect(r.resolveTeam('3408', undefined, undefined, s)).resolves.toBe(t);
    const rows = await db.query(`SELECT team_id, source_ref FROM season_teams WHERE season_id = $1`, [s]);
    expect(rows.rows).toEqual([{ team_id: t, source_ref: '3408' }]);
  });

  it('no aprende refs de club ni de abreviatura (no son de inscripción)', async () => {
    const sportId = await crearDeporte();
    const t = await equipo(sportId, 'LICEO', 'fep_club_44');
    const s = await crearTemporada(await crearCompeticion(sportId));
    const r = new RefResolver(sportId);
    await r.resolveTeam('fep_club_44', undefined, undefined, s);
    const rows = await db.query(`SELECT count(*)::int AS n FROM season_teams WHERE source_ref IS NOT NULL`);
    expect(rows.rows[0]).toEqual({ n: 0 });
    expect(t).toBeTruthy();
  });
});
