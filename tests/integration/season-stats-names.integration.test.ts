/**
 * C0 — Los líderes de temporada traen nombre y apellidos de la ficha, para que
 * la web presente "Juan Gabriel Fernandez" sin partir el nombre crudo del acta.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { seasonStatsRouter } from '../../apps/api/src/routes/season-stats.js';
import { limpiar } from './support/db.js';
import { crearPartido } from './support/factorias.js';

beforeEach(limpiar);
afterAll(closeDb);

describe('GET /seasons/:id/stats — nombres de los líderes', () => {
  it('topScorers lleva firstName y lastName de players', async () => {
    const p = await crearPartido({ status: 'finished' });
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO players (sport_id, first_name, last_name, slug)
       VALUES ($1, 'JUAN GABRIEL', 'FERNANDEZ DELGADO', 'jgfd') RETURNING id`, [p.sportId]);
    await db.query(
      `INSERT INTO match_lineups (match_id, team_id, is_home, player_name, player_id, goals)
       VALUES ($1, $2, TRUE, 'FERNANDEZ DELGADO JUAN GABRIEL', $3, 2)`,
      [p.matchId, p.homeTeamId, rows[0]!.id]);

    const res = await seasonStatsRouter.request(`/${p.seasonId}/stats`);
    expect(res.status).toBe(200);
    const body = await res.json() as { topScorers: Array<Record<string, unknown>> };
    expect(body.topScorers[0]).toMatchObject({
      playerName: 'FERNANDEZ DELGADO JUAN GABRIEL', firstName: 'JUAN GABRIEL', lastName: 'FERNANDEZ DELGADO', value: 2,
    });
  });
});
