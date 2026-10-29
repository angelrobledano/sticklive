/**
 * Separar un equipo del histórico que mezcla secciones: cada temporada
 * enrutada se lleva sus partidos, alineaciones, eventos, inscripción,
 * clasificación y plantilla; lo no enrutado se queda.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, splitTeam, SplitTeamError } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada, crearEquipo } from './support/factorias.js';

beforeEach(limpiar);
afterAll(closeDb);

async function partido(seasonId: string, home: string, away: string, ref: string): Promise<string> {
  return (await db.query<{ id: string }>(
    `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, source_ref, winner_team_id)
     VALUES ($1,$2,$3,'finished','2024-01-10T18:00:00Z',$4,$2) RETURNING id`, [seasonId, home, away, ref])).rows[0]!.id;
}

describe('splitTeam', () => {
  it('lleva la temporada femenina a un equipo nuevo del mismo club y deja la masculina', async () => {
    const sportId = await crearDeporte();
    const club = (await db.query<{ id: string }>(
      `INSERT INTO clubs (sport_id, canonical_name, slug) VALUES ($1,'CP Voltregà','cp-voltrega') RETURNING id`, [sportId])).rows[0]!.id;
    const mezcla = await crearEquipo(sportId, 'C.P. VOLTREGA');
    await db.query(`UPDATE teams SET club_id = $1 WHERE id = $2`, [club, mezcla]);
    const rival = await crearEquipo(sportId, 'RIVAL');
    const fem = await crearTemporada(await crearCompeticion(sportId));
    const masc = await crearTemporada(await crearCompeticion(sportId));
    const mf = await partido(fem, mezcla, rival, 'm_f');
    const mm = await partido(masc, rival, mezcla, 'm_m');
    const { rows: [p] } = await db.query<{ id: string }>(
      `INSERT INTO players (sport_id, first_name, last_name, slug, source_ref) VALUES ($1,'A','B','ab','fep_player_1') RETURNING id`, [sportId]);
    await db.query(`INSERT INTO team_players (season_id, team_id, player_id) VALUES ($1,$2,$3)`, [fem, mezcla, p!.id]);
    await db.query(`INSERT INTO season_teams (season_id, team_id) VALUES ($1,$2), ($3,$2)`, [fem, mezcla, masc]);

    const dry = await splitTeam(mezcla, [{ seasonIds: [fem], target: { name: 'CP VOLTREGA FEMENÍ', gender: 'female', ageCategory: 'senior' } }], { dryRun: true });
    expect(dry.routes[0]).toMatchObject({ created: true, matches: 1 });
    expect((await db.query(`SELECT 1 FROM teams WHERE name = 'CP VOLTREGA FEMENÍ'`)).rowCount).toBe(0);

    const r = await splitTeam(mezcla, [{ seasonIds: [fem], target: { name: 'CP VOLTREGA FEMENÍ', gender: 'female', ageCategory: 'senior' } }]);
    const nuevo = r.routes[0]!.teamId;
    const m = async (id: string) => (await db.query<{ home_team_id: string; away_team_id: string; winner_team_id: string }>(
      `SELECT home_team_id, away_team_id, winner_team_id FROM matches WHERE id = $1`, [id])).rows[0]!;
    expect(await m(mf)).toEqual({ home_team_id: nuevo, away_team_id: rival, winner_team_id: nuevo });
    expect((await m(mm)).away_team_id).toBe(mezcla);
    const t = (await db.query(`SELECT club_id, gender, age_category FROM teams WHERE id = $1`, [nuevo])).rows[0];
    expect(t).toEqual({ club_id: club, gender: 'female', age_category: 'senior' });
    expect((await db.query(`SELECT team_id FROM team_players WHERE season_id = $1`, [fem])).rows[0]!.team_id).toBe(nuevo);
    expect((await db.query(`SELECT team_id FROM season_teams WHERE season_id = $1`, [masc])).rows[0]!.team_id).toBe(mezcla);
  });

  it('se niega si el origen se enfrenta al destino en esas temporadas', async () => {
    const sportId = await crearDeporte();
    const a = await crearEquipo(sportId, 'LICEO');
    const b = await crearEquipo(sportId, 'LICEO B');
    const s = await crearTemporada(await crearCompeticion(sportId));
    await partido(s, a, b, 'derbi');
    await expect(splitTeam(a, [{ seasonIds: [s], target: { teamId: b } }])).rejects.toBeInstanceOf(SplitTeamError);
  });
});
