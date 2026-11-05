/**
 * Plantilla del equipo con su línea estadística completa: PJ (por alineación,
 * aunque no marque), goles, asistencias, azules, rojas, penaltis y directas.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearEquipo, crearCompeticion, crearTemporada } from './support/factorias.js';
import { teamDetailRouter } from '../../apps/api/src/routes/team-detail.js';

beforeEach(limpiar);
afterAll(closeDb);

describe('GET /teams/:id — plantilla con PJ y asistencias', () => {
  it('cuenta PJ por acta, asistencias y eventos del jugador en su equipo', async () => {
    const sportId = await crearDeporte();
    const season = await crearTemporada(await crearCompeticion(sportId));
    await db.query(`UPDATE seasons SET start_date = '2026-09-01', is_current = TRUE WHERE id = $1`, [season]);
    const [me, rival] = [await crearEquipo(sportId, 'ME'), await crearEquipo(sportId, 'RIVAL')];
    await db.query(`INSERT INTO season_teams (season_id, team_id) VALUES ($1,$2),($1,$3)`, [season, me, rival]);
    const jugador = async (last: string) => (await db.query<{ id: string }>(
      `INSERT INTO players (sport_id, first_name, last_name, slug) VALUES ($1,'X',$2,$2) RETURNING id`, [sportId, last])).rows[0]!.id;
    const [goleador, suplente] = [await jugador('GOLEADOR'), await jugador('SUPLENTE')];
    await db.query(`INSERT INTO team_players (season_id, team_id, player_id, jersey_number) VALUES ($1,$2,$3,9),($1,$2,$4,12)`, [season, me, goleador, suplente]);

    const partido = async (home: boolean, ref: string, status = 'finished') => (await db.query<{ id: string; scheduled_at: Date }>(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, home_score, away_score, status, scheduled_at, source_ref)
       VALUES ($1,$2,$3,3,1,$4,'2026-10-01T18:00:00Z',$5) RETURNING id, scheduled_at`,
      [season, home ? me : rival, home ? rival : me, status, ref])).rows[0]!;
    const [m1, m2, m3] = [await partido(true, 'a'), await partido(false, 'b'), await partido(true, 'c', 'scheduled')];
    const alinea = async (m: string, home: boolean, player: string, name: string, assists = 0) => db.query(
      `INSERT INTO match_lineups (match_id, is_home, player_name, player_id, assists) VALUES ($1,$2,$3,$4,$5)`,
      [m, home, name, player, assists]);
    await alinea(m1.id, true, goleador, 'GOLEADOR X', 2);
    await alinea(m2.id, false, goleador, 'GOLEADOR X', 1);
    await alinea(m3.id, true, goleador, 'GOLEADOR X');
    await alinea(m1.id, true, suplente, 'SUPLENTE X');
    const ev = (m: { id: string; scheduled_at: Date }, type: string, ref: string) => db.query(
      `INSERT INTO match_events (match_id, match_date, team_id, player_id, event_type, source_ref) VALUES ($1,$2::date,$3,$4,$5,$6)`,
      [m.id, m.scheduled_at, me, goleador, type, ref]);
    await ev(m1, 'goal', 'g1'); await ev(m1, 'goal', 'g2'); await ev(m2, 'goal', 'g3');
    await ev(m1, 'blue_card', 'b1'); await ev(m2, 'direct_foul', 'd1'); await ev(m2, 'penalty', 'p1');

    const res = await teamDetailRouter.request(`/${me}`);
    const body = await res.json() as { squad: Array<Record<string, unknown>> };
    const g = body.squad.find((p) => p['playerId'] === goleador)!;
    const s = body.squad.find((p) => p['playerId'] === suplente)!;
    expect(g).toMatchObject({ played: 2, goals: 3, assists: 3, blueCards: 1, redCards: 0, penalties: 1, directFouls: 1 });
    expect(s).toMatchObject({ played: 1, goals: 0, assists: 0 });
  });

  // 05/11/2026: la FAP da los goles en el acta (match_lineups.goals) y los
  // eventos llegan sin jugador. La plantilla debe contarlos como la tabla de
  // goleadores, sin sumar dos veces el mismo gol si también hay evento.
  it('goles del acta cuando no hay eventos con jugador, sin doble conteo', async () => {
    const sportId = await crearDeporte();
    const season = await crearTemporada(await crearCompeticion(sportId));
    await db.query(`UPDATE seasons SET start_date = '2026-09-01', is_current = TRUE WHERE id = $1`, [season]);
    const [me, rival] = [await crearEquipo(sportId, 'ME'), await crearEquipo(sportId, 'RIVAL')];
    await db.query(`INSERT INTO season_teams (season_id, team_id) VALUES ($1,$2),($1,$3)`, [season, me, rival]);
    const pid = (await db.query<{ id: string }>(
      `INSERT INTO players (sport_id, first_name, last_name, slug) VALUES ($1,'L','FONTAN','fontan') RETURNING id`, [sportId])).rows[0]!.id;
    await db.query(`INSERT INTO team_players (season_id, team_id, player_id) VALUES ($1,$2,$3)`, [season, me, pid]);
    const partido = async (ref: string) => (await db.query<{ id: string; scheduled_at: Date }>(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, home_score, away_score, status, scheduled_at, source_ref)
       VALUES ($1,$2,$3,9,2,'finished','2026-10-01T18:00:00Z',$4) RETURNING id, scheduled_at`, [season, me, rival, ref])).rows[0]!;
    const [m1, m2] = [await partido('x1'), await partido('x2')];
    await db.query(`INSERT INTO match_lineups (match_id, is_home, player_name, player_id, goals) VALUES ($1,TRUE,'F',$3,7),($2,TRUE,'F',$3,1)`, [m1.id, m2.id, pid]);
    // m2: el mismo gol también como evento con jugador.
    await db.query(`INSERT INTO match_events (match_id, match_date, team_id, player_id, event_type, source_ref) VALUES ($1,$2::date,$3,$4,'goal','e1')`,
      [m2.id, m2.scheduled_at, me, pid]);
    const body = await (await teamDetailRouter.request(`/${me}`)).json() as { squad: Array<Record<string, unknown>> };
    expect(body.squad.find((p) => p['playerId'] === pid)).toMatchObject({ played: 2, goals: 8 });
  });
});
