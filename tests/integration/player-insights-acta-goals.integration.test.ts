/**
 * 05/11/2026 (Lucas Fontán, Andalucía Infantil): la FAP da los goles en la
 * alineación del acta y los eventos de gol llegan sin jugador ni equipo. Los
 * datos de la ficha (goles, % del equipo, hat-tricks) salían a 0.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearEquipo, crearCompeticion, crearTemporada } from './support/factorias.js';
import { playerInsightsRouter } from '../../apps/api/src/routes/player-insights.js';

beforeEach(limpiar);
afterAll(closeDb);

describe('GET /players/:id/insights con goles solo en el acta', () => {
  it('goles, % del equipo y hat-tricks desde match_lineups', async () => {
    const sportId = await crearDeporte();
    const season = await crearTemporada(await crearCompeticion(sportId));
    await db.query(`UPDATE seasons SET start_date = '2026-09-01', is_current = TRUE WHERE id = $1`, [season]);
    const [me, rival] = [await crearEquipo(sportId, 'ME'), await crearEquipo(sportId, 'RIVAL')];
    const pid = (await db.query<{ id: string }>(
      `INSERT INTO players (sport_id, first_name, last_name, slug) VALUES ($1,'L','FONTAN','fontan') RETURNING id`, [sportId])).rows[0]!.id;
    // 5 partidos (el mínimo de pares para percentiles): 7, 2, 0, 0, 0 goles. El equipo marca 10 en cada uno.
    const goles = [7, 2, 0, 0, 0];
    for (let i = 0; i < goles.length; i++) {
      const m = (await db.query<{ id: string }>(
        `INSERT INTO matches (season_id, home_team_id, away_team_id, home_score, away_score, status, scheduled_at, source_ref)
         VALUES ($1,$2,$3,10,1,'finished',$4,$5) RETURNING id`,
        [season, me, rival, `2026-10-0${i + 1}T18:00:00Z`, `m${i}`])).rows[0]!.id;
      await db.query(`INSERT INTO match_lineups (match_id, team_id, is_home, player_name, player_id, goals) VALUES ($1,$2,TRUE,'F',$3,$4)`,
        [m, me, pid, goles[i]]);
    }
    const res = await playerInsightsRouter.request(`/${pid}/insights`);
    const body = await res.json() as { facts: { goals: number; teamGoals: number; goalSharePct: number; hatTricks: number; scorerRank: number } };
    expect(body.facts).toMatchObject({ goals: 9, teamGoals: 50, goalSharePct: 18, hatTricks: 1, scorerRank: 1 });
  });
});
