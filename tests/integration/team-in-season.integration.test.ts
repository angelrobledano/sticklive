/**
 * findTeamInSeasonByName — resolver un NOMBRE de clasificación dentro de los
 * equipos de ESA temporada.
 *
 * Regresión real (2026/27): las clasificaciones traen solo el nombre, y un filial
 * se llama igual que su primer equipo ("CE NOIA FREIXENET"). Resolviendo contra
 * toda la tabla, el nombre caía en el primer equipo —que juega en otra liga— y la
 * clasificación de la liga inferior mostraba al de arriba.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, findTeamInSeasonByName } from '@sports/db';
import { limpiar } from './support/db.js';

beforeEach(async () => { await limpiar(); });
afterAll(async () => { await closeDb(); });

async function sembrar() {
  const sport = (await db.query<{ id: string }>(
    `INSERT INTO sports (name, slug) VALUES ('Hockey patines', 'hockey-patines') RETURNING id`
  )).rows[0]!;
  const comp = (await db.query<{ id: string }>(
    `INSERT INTO competitions (sport_id, name, slug) VALUES ($1, 'Ok Liga', 'ok-liga') RETURNING id`,
    [sport.id]
  )).rows[0]!;
  const season = (await db.query<{ id: string }>(
    `INSERT INTO seasons (competition_id, name, slug) VALUES ($1, '2026/27', '2026-27') RETURNING id`,
    [comp.id]
  )).rows[0]!;
  const team = async (name: string, slug: string) => {
    const t = (await db.query<{ id: string }>(
      `INSERT INTO teams (sport_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [sport.id, name, slug]
    )).rows[0]!;
    await db.query(`INSERT INTO season_teams (season_id, team_id) VALUES ($1, $2)`, [season.id, t.id]);
    return t.id;
  };
  return { sport, comp, season, team };
}

describe('findTeamInSeasonByName', () => {
  it('encuentra el equipo de esa temporada por nombre exacto', async () => {
    const { season, team } = await sembrar();
    const id = await team('CDM HOCKEY PATINES', 'cdm-hockey-patines');
    expect(await findTeamInSeasonByName(season.id, 'CDM HOCKEY PATINES')).toBe(id);
  });

  it('REGRESIÓN: el nombre del primer equipo resuelve al filial " B" de esa temporada', async () => {
    const { season, team } = await sembrar();
    const filial = await team('CE NOIA FREIXENET B', 'ce-noia-freixenet-b');
    expect(await findTeamInSeasonByName(season.id, 'CE NOIA FREIXENET')).toBe(filial);
  });

  it('no cruza entre temporadas: sin equipo coincidente en esa temporada → null', async () => {
    const { sport, comp, team } = await sembrar();
    await team('ACORDES', 'acordes');
    const season2 = (await db.query<{ id: string }>(
      `INSERT INTO seasons (competition_id, name, slug) VALUES ($1, '2025/26', '2025-26') RETURNING id`,
      [comp.id]
    )).rows[0]!;
    const aId = (await db.query<{ id: string }>(
      `INSERT INTO teams (sport_id, name, slug) VALUES ($1, 'CE NOIA FREIXENET', 'ce-noia-freixenet-ok') RETURNING id`,
      [sport.id]
    )).rows[0]!.id;
    await db.query(`INSERT INTO season_teams (season_id, team_id) VALUES ($1, $2)`, [season2.id, aId]);

    // El primer equipo existe, pero en OTRA temporada: en esta no hay match.
    expect(await findTeamInSeasonByName(season2.id, 'CE NOIA FREIXENET')).toBe(aId);
    const otraSeason = (await db.query<{ id: string }>(
      `INSERT INTO seasons (competition_id, name, slug) VALUES ($1, '2024/25', '2024-25') RETURNING id`,
      [comp.id]
    )).rows[0]!;
    expect(await findTeamInSeasonByName(otraSeason.id, 'CE NOIA FREIXENET')).toBeNull();
  });
});
