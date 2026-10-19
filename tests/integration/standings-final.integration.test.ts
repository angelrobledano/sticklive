/**
 * C7 — Clasificación final de temporadas cerradas.
 *
 * La clasificación se copia de la fuente cada hora, pero solo de las
 * competiciones activas (`competition_sources`, un idc por competición). Al
 * pasar a la temporada nueva, la anterior deja de refrescarse: OK Liga Plata
 * Sur 2025/26 se quedó en la jornada 20 de 22 (Simar 46 puntos en vez de 52)
 * aunque la fuente tiene la tabla final. Esta consulta encuentra esas tablas:
 * temporada sin partidos pendientes y algún equipo con menos PJ que partidos
 * de liga terminados.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearPartido } from './support/factorias.js';
import { findStaleFinalStandings } from '../../apps/etl/src/standings-reconcile.js';

beforeEach(limpiar);
afterAll(closeDb);

async function standing(seasonId: string, teamId: string, played: number) {
  await db.query(
    `INSERT INTO standings (season_id, team_id, played, won, drawn, lost, goals_for, goals_against, points)
     VALUES ($1,$2,$3,0,0,0,0,0,0)`, [seasonId, teamId, played]);
}

/** Temporada de la FEP (idc en source_ref) con un partido terminado y su tabla. */
async function temporadaCerrada(playedEnTabla: number) {
  const p = await crearPartido({ status: 'finished' });
  await db.query(`UPDATE seasons SET source_ref = '3154', is_current = false WHERE id = $1`, [p.seasonId]);
  await db.query(`UPDATE matches SET home_score = 2, away_score = 1 WHERE id = $1`, [p.matchId]);
  await standing(p.seasonId, p.homeTeamId, playedEnTabla);
  await standing(p.seasonId, p.awayTeamId, playedEnTabla);
  return p;
}

describe('findStaleFinalStandings (C7)', () => {
  it('temporada cerrada con la tabla atrasada: candidata, con su idc', async () => {
    const p = await temporadaCerrada(0);
    expect(await findStaleFinalStandings()).toEqual([
      expect.objectContaining({ seasonId: p.seasonId, idc: '3154', staleTeams: 2 }),
    ]);
  });

  it('tabla al día: no es candidata', async () => {
    await temporadaCerrada(1);
    expect(await findStaleFinalStandings()).toEqual([]);
  });

  it('con partidos pendientes la temporada sigue abierta: no es candidata', async () => {
    const p = await temporadaCerrada(0);
    await db.query(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at)
       VALUES ($1, $2, $3, 'scheduled', NOW() + interval '3 days')`,
      [p.seasonId, p.awayTeamId, p.homeTeamId]);
    expect(await findStaleFinalStandings()).toEqual([]);
  });

  it('los partidos de una fase eliminatoria no cuentan para la tabla', async () => {
    const p = await temporadaCerrada(1);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO phases (season_id, name, kind, ordinal) VALUES ($1, 'Playoff', 'knockout', 2) RETURNING id`,
      [p.seasonId]);
    await db.query(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, phase_id, home_score, away_score)
       VALUES ($1, $2, $3, 'finished', NOW(), $4, 1, 0)`,
      [p.seasonId, p.awayTeamId, p.homeTeamId, rows[0]!.id]);
    expect(await findStaleFinalStandings()).toEqual([]);
  });

  it('sin idc de la FEP no hay de dónde refrescar: no es candidata', async () => {
    const p = await temporadaCerrada(0);
    await db.query(`UPDATE seasons SET source_ref = NULL WHERE id = $1`, [p.seasonId]);
    expect(await findStaleFinalStandings()).toEqual([]);
  });
});
