/**
 * Fusión de dos fichas del mismo equipo (p. ej. CD Mundaiz de la RFEP y de la
 * Federación Vasca): todo pasa al que se queda, el otro se borra y redirige.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, mergeTeams, recordSeasonTeamRef, findTeamBySourceRef, resolveEntityRedirect } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada } from './support/factorias.js';

beforeEach(limpiar);
afterAll(closeDb);

async function equipo(sportId: string, name: string, ref: string, extra: { gender?: string; age?: string } = {}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO teams (sport_id, name, slug, source_ref, gender, age_category) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [sportId, name, `${name.toLowerCase().replace(/\W+/g, '-')}-${ref}`, ref, extra.gender ?? 'male', extra.age ?? 'senior']);
  return rows[0]!.id;
}

async function partido(seasonId: string, home: string, away: string, ref: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, source_ref)
     VALUES ($1,$2,$3,'finished','2026-10-03T15:30:00Z',$4) RETURNING id`, [seasonId, home, away, ref]);
  return rows[0]!.id;
}

describe('mergeTeams', () => {
  it('mueve partidos, inscripciones y clasificación; hereda las refs y redirige', async () => {
    const sportId = await crearDeporte();
    const rfep = await equipo(sportId, 'CD MUNDAIZ', '3401');
    const fvp = await equipo(sportId, 'C.D. Mundaiz', 'fvp_liga-norte_cd-mundaiz');
    const rival = await equipo(sportId, 'Bat Gora', 'fvp_liga-norte_bat-gora');
    const sNorte = await crearTemporada(await crearCompeticion(sportId, 'fvp_competition_liga-norte'));
    await recordSeasonTeamRef(sNorte, fvp, 'fvp_liga-norte_cd-mundaiz');
    const m = await partido(sNorte, fvp, rival, 'fvp_match_1');
    await db.query(`INSERT INTO standings (season_id, team_id, position, played, won, drawn, lost, goals_for, goals_against, points)
                    VALUES ($1,$2,1,1,1,0,0,3,1,3)`, [sNorte, fvp]);

    const r = await mergeTeams(rfep, fvp);
    expect(r.moved['matches_home']).toBe(1);

    const match = (await db.query(`SELECT home_team_id FROM matches WHERE id = $1`, [m])).rows[0];
    expect(match.home_team_id).toBe(rfep);
    expect((await db.query(`SELECT team_id, source_ref FROM season_teams WHERE season_id = $1`, [sNorte])).rows)
      .toEqual([{ team_id: rfep, source_ref: 'fvp_liga-norte_cd-mundaiz' }]);
    expect((await db.query(`SELECT team_id FROM standings WHERE season_id = $1`, [sNorte])).rows).toEqual([{ team_id: rfep }]);
    // El scraper vasco sigue encontrando el equipo por su ref.
    expect((await findTeamBySourceRef('fvp_liga-norte_cd-mundaiz'))?.id).toBe(rfep);
    expect((await db.query(`SELECT 1 FROM teams WHERE id = $1`, [fvp])).rowCount).toBe(0);
    await expect(resolveEntityRedirect('team', fvp)).resolves.toEqual({ status: 'moved', newId: rfep });
  });

  it('en una temporada común se queda la fila del que se conserva', async () => {
    const sportId = await crearDeporte();
    const a = await equipo(sportId, 'A', 'a1');
    const b = await equipo(sportId, 'A bis', 'b1');
    const s = await crearTemporada(await crearCompeticion(sportId));
    await recordSeasonTeamRef(s, a, 'a1');
    await recordSeasonTeamRef(s, b, 'b1');
    const r = await mergeTeams(a, b);
    expect(r.dropped['season_teams']).toBe(1);
    expect((await db.query(`SELECT team_id FROM season_teams WHERE season_id = $1`, [s])).rows).toEqual([{ team_id: a }]);
  });

  it('se niega con secciones distintas (júnior vs sénior) salvo force', async () => {
    const sportId = await crearDeporte();
    const senior = await equipo(sportId, 'Mundaiz', 's1');
    const junior = await equipo(sportId, 'Mundaiz', 'j1', { age: 'junior' });
    await expect(mergeTeams(senior, junior)).rejects.toThrow(/secciones distintas/);
    expect((await db.query(`SELECT 1 FROM teams WHERE id = $1`, [junior])).rowCount).toBe(1);
  });

  it('se niega si se han enfrentado', async () => {
    const sportId = await crearDeporte();
    const a = await equipo(sportId, 'Loyola A', 'la');
    const b = await equipo(sportId, 'Loyola B', 'lb');
    await partido(await crearTemporada(await crearCompeticion(sportId)), a, b, 'm1');
    await expect(mergeTeams(a, b)).rejects.toThrow(/se han enfrentado/);
  });

  it('en seco no cambia nada pero cuenta lo que haría', async () => {
    const sportId = await crearDeporte();
    const a = await equipo(sportId, 'A', 'a2');
    const b = await equipo(sportId, 'B', 'b2');
    const c = await equipo(sportId, 'C', 'c2');
    await partido(await crearTemporada(await crearCompeticion(sportId)), b, c, 'm2');
    const r = await mergeTeams(a, b, { dryRun: true });
    expect(r.moved['matches_home']).toBe(1);
    expect((await db.query(`SELECT 1 FROM teams WHERE id = $1`, [b])).rowCount).toBe(1);
    expect((await db.query(`SELECT home_team_id FROM matches WHERE source_ref = 'm2'`)).rows[0].home_team_id).toBe(b);
  });
});
