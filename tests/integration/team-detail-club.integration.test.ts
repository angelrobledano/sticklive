/**
 * Fase 0.3 — GET /teams/:id expone el club canónico (Entity Resolution).
 *
 * Aditivo y null-safe: `team.club` es null mientras `teams.club_id` no esté
 * relleno (en prod, hasta correr el backfill 0.2). Postgres real; se golpea el
 * router de Hono directamente con `.request()`.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearEquipo } from './support/factorias.js';
import { teamDetailRouter } from '../../apps/api/src/routes/team-detail.js';

async function getTeam(id: string): Promise<{ status: number; body: any }> {
  const res = await teamDetailRouter.request(`/${id}`);
  return { status: res.status, body: await res.json() };
}

let sportId: string;

beforeEach(async () => {
  await limpiar();
  sportId = await crearDeporte();
});

afterAll(async () => {
  await closeDb();
});

describe('Fase 0.3 — GET /teams/:id expone el club', () => {
  it('team.club = null cuando el team no tiene club_id (prod pre-backfill)', async () => {
    const teamId = await crearEquipo(sportId);

    const { status, body } = await getTeam(teamId);

    expect(status).toBe(200);
    expect(body.team.id).toBe(teamId);
    expect(body.team.club).toBeNull();
  });

  it('devuelve el club canónico cuando teams.club_id apunta a un club', async () => {
    const teamId = await crearEquipo(sportId);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO clubs (sport_id, canonical_name, slug, city, country, crest_url)
       VALUES ($1, 'Deportivo Liceo', 'liceo', 'A Coruña', 'ES', 'https://ejemplo.invalido/crest.png')
       RETURNING id`,
      [sportId],
    );
    const clubId = rows[0]!.id;
    await db.query(`UPDATE teams SET club_id = $1 WHERE id = $2`, [clubId, teamId]);

    const { status, body } = await getTeam(teamId);

    expect(status).toBe(200);
    expect(body.team.club).toEqual({
      id: clubId,
      canonicalName: 'Deportivo Liceo',
      slug: 'liceo',
      crestUrl: 'https://ejemplo.invalido/crest.png',
      city: 'A Coruña',
      country: 'ES',
    });
  });

  it('404 para un team inexistente', async () => {
    const { status } = await getTeam('00000000-0000-0000-0000-000000000000');
    expect(status).toBe(404);
  });
});
