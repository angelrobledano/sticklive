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
import { crearDeporte, crearEquipo, crearCompeticion, crearTemporada } from './support/factorias.js';
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

  it('no lista temporadas de la sección contraria (aislamiento de género)', async () => {
    const teamId = await crearEquipo(sportId, 'CH MATARÓ');
    await db.query(`UPDATE teams SET gender = 'female', age_category = 'senior' WHERE id = $1`, [teamId]);

    // Temporada femenina (la correcta)…
    const femComp = await crearCompeticion(sportId);
    await db.query(`UPDATE competitions SET gender = 'female', age_category = 'senior' WHERE id = $1`, [femComp]);
    const femSeason = await crearTemporada(femComp);
    await db.query(`INSERT INTO season_teams (season_id, team_id) VALUES ($1, $2)`, [femSeason, teamId]);
    await db.query(
      `INSERT INTO standings (season_id, team_id, position, played) VALUES ($1, $2, 1, 0)`,
      [femSeason, teamId],
    );

    // …y una masculina mal atribuida al mismo team (el bug de Mataró).
    const mascComp = await crearCompeticion(sportId);
    await db.query(`UPDATE competitions SET gender = 'male', age_category = 'senior' WHERE id = $1`, [mascComp]);
    const mascSeason = await crearTemporada(mascComp);
    await db.query(`INSERT INTO season_teams (season_id, team_id) VALUES ($1, $2)`, [mascSeason, teamId]);
    await db.query(
      `INSERT INTO standings (season_id, team_id, position, played) VALUES ($1, $2, 2, 4)`,
      [mascSeason, teamId],
    );

    const { status, body } = await getTeam(teamId);

    expect(status).toBe(200);
    expect(body.seasons.map((s: { id: string }) => s.id)).toEqual([femSeason]);
    expect(body.selectedSeasonId).toBe(femSeason);
    expect(body.standing.competitionId).toBe(femComp);
  });

  it('otros equipos del club: con su competición y sección; sin partidos, fuera', async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO clubs (sport_id, canonical_name, slug) VALUES ($1, 'Reus Deportiu', 'reus') RETURNING id`, [sportId]);
    const clubId = rows[0]!.id;
    const [primero, alevin, vacio, rival] = [await crearEquipo(sportId), await crearEquipo(sportId), await crearEquipo(sportId), await crearEquipo(sportId)];
    await db.query(`UPDATE teams SET club_id = $1, team_type = 'club' WHERE id = ANY($2::uuid[])`, [clubId, [primero, alevin, vacio]]);
    await db.query(`UPDATE teams SET age_category = 'alevin', squad_level = 3 WHERE id = $1`, [alevin]);
    const compId = await crearCompeticion(sportId);
    await db.query(`UPDATE competitions SET name = 'Aleví Or' WHERE id = $1`, [compId]);
    const seasonId = await crearTemporada(compId);
    await db.query(`INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, source_ref)
                    VALUES ($1, $2, $3, 'scheduled', NOW(), 'm-alevin')`, [seasonId, alevin, rival]);

    const { body } = await getTeam(primero);
    expect(body.clubTeams).toHaveLength(1);
    expect(body.clubTeams[0]).toMatchObject({ id: alevin, section: 'base', sectionSuffix: 'C', competition: { id: compId, name: 'Aleví Or' } });
  });
});
