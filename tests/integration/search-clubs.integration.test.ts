/**
 * Búsqueda con clubes (30/10/2026): «Claret» devolvía cinco «CD Claret» sin
 * nada que los distinguiera. Ahora: el club, y cada equipo con su club,
 * categoría y competición. Postgres real.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearEquipo, crearCompeticion, crearTemporada } from './support/factorias.js';
import { searchRouter } from '../../apps/api/src/routes/search.js';

beforeEach(limpiar);
afterAll(closeDb);

describe('GET /search — clubes', () => {
  it('encuentra el club por el nombre de sus equipos y etiqueta cada equipo', async () => {
    const sportId = await crearDeporte();
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO clubs (sport_id, canonical_name, slug, city) VALUES ($1, 'Club Deportivo Claret', 'cd-claret', 'Sevilla') RETURNING id`, [sportId]);
    const clubId = rows[0]!.id;
    const [alevin, infantil, rival] = [await crearEquipo(sportId), await crearEquipo(sportId), await crearEquipo(sportId)];
    await db.query(`UPDATE teams SET name = 'CD CLARET', display_name = NULL, club_id = $1, team_type = 'club', age_category = 'alevin' WHERE id = $2`, [clubId, alevin]);
    await db.query(`UPDATE teams SET name = 'CD CLARET', display_name = NULL, club_id = $1, team_type = 'club', age_category = 'infantil', squad_level = 2 WHERE id = $2`, [clubId, infantil]);
    const compId = await crearCompeticion(sportId);
    await db.query(`UPDATE competitions SET name = 'ALEVÍN ANDALUZ' WHERE id = $1`, [compId]);
    const seasonId = await crearTemporada(compId);
    await db.query(`INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, source_ref)
                    VALUES ($1, $2, $3, 'scheduled', NOW(), 'm-claret')`, [seasonId, alevin, rival]);

    const res = await searchRouter.request('/?q=claret');
    const body = await res.json() as { clubs: any[]; teams: any[] };
    expect(body.clubs).toEqual([{ id: clubId, slug: 'cd-claret', name: 'Club Deportivo Claret', city: 'Sevilla', crestUrl: null, teamCount: 2 }]);
    const a = body.teams.find((t) => t.id === alevin);
    expect(a).toMatchObject({ clubId, clubSlug: 'cd-claret', ageCategory: 'alevin', competitionName: 'ALEVÍN ANDALUZ' });
    expect(body.teams.find((t) => t.id === infantil)).toMatchObject({ ageCategory: 'infantil', squadLevel: 2, competitionName: null });
  });
});
