/**
 * C2 — GET /seasons/:id/insights: las cifras salen de la base y las entidades
 * citadas vienen con su nombre para enlazarlas. Los generadores tienen sus
 * tests unitarios (apps/api/src/lib/insights.test.ts); aquí se comprueba la
 * carga: qué partidos cuentan, de dónde salen los nombres y la visibilidad.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { seasonInsightsRouter } from '../../apps/api/src/routes/season-insights.js';
import { limpiar } from './support/db.js';
import { crearPartido, crearEquipo } from './support/factorias.js';

beforeEach(limpiar);
afterAll(closeDb);

async function partido(seasonId: string, home: string, away: string, hs: number, as: number) {
  await db.query(
    `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, home_score, away_score)
     VALUES ($1, $2, $3, 'finished', NOW() - interval '1 day', $4, $5)`, [seasonId, home, away, hs, as]);
}

describe('GET /seasons/:id/insights', () => {
  it('goleada con su partido y los nombres de los equipos', async () => {
    const p = await crearPartido({ status: 'finished' });
    await db.query(`UPDATE matches SET home_score = 10, away_score = 1 WHERE id = $1`, [p.matchId]);
    await db.query(`UPDATE teams SET name = 'CLUB LOCAL' WHERE id = $1`, [p.homeTeamId]);

    const res = await seasonInsightsRouter.request(`/${p.seasonId}/insights`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      insights: Array<{ kind: string; matchId: string | null; values: Record<string, number> }>;
      teams: Record<string, { name: string }>; matches: Record<string, unknown>;
    };
    const big = body.insights.find((i) => i.kind === 'biggest_win');
    expect(big).toMatchObject({ matchId: p.matchId, values: { home: 10, away: 1 } });
    expect(body.teams[p.homeTeamId]?.name).toBe('CLUB LOCAL');
    expect(body.matches[p.matchId]).toMatchObject({ homeTeamId: p.homeTeamId, awayTeamId: p.awayTeamId });
  });

  it('único invicto desde los partidos de la temporada', async () => {
    const p = await crearPartido({ status: 'finished' });
    await db.query(`UPDATE matches SET home_score = 3, away_score = 1 WHERE id = $1`, [p.matchId]);
    const c = await crearEquipo(p.sportId);
    await partido(p.seasonId, p.homeTeamId, c, 2, 2);
    await partido(p.seasonId, c, p.awayTeamId, 1, 0);
    await partido(p.seasonId, p.awayTeamId, p.homeTeamId, 0, 4);
    await partido(p.seasonId, c, p.homeTeamId, 1, 1);

    const body = await (await seasonInsightsRouter.request(`/${p.seasonId}/insights`)).json() as {
      insights: Array<{ kind: string; teamIds: string[] }>;
    };
    expect(body.insights.find((i) => i.kind === 'only_unbeaten')?.teamIds).toEqual([p.homeTeamId]);
  });

  it('temporada oculta por calidad: 404', async () => {
    const p = await crearPartido({ status: 'finished' });
    await db.query(`UPDATE seasons SET data_quality = 'en_revision' WHERE id = $1`, [p.seasonId]);
    expect((await seasonInsightsRouter.request(`/${p.seasonId}/insights`)).status).toBe(404);
  });

  it('id que no es uuid: 404', async () => {
    expect((await seasonInsightsRouter.request(`/no-es-uuid/insights`)).status).toBe(404);
  });
});
