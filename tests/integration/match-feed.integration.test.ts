/**
 * GET /matches/current?scope=feed|following (spec 2026-10-30): qué sale en
 * Partidos. Postgres real, misma regla que la web y la app.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada, crearPartido } from './support/factorias.js';

process.env['LIVE_CACHE_TTL_MS'] = '0';
const { liveRouter } = await import('../../apps/api/src/routes/live.js');

interface Body { matches: Array<{ id: string; status: string }>; hiddenCount?: number }
async function get(path: string): Promise<Body> {
  return (await (await liveRouter.request(path)).json()) as Body;
}

beforeEach(limpiar);
afterAll(closeDb);

async function competicion(opts: { featured?: number; tier?: number; country?: string } = {}) {
  const sportId = await crearDeporte();
  const compId = await crearCompeticion(sportId);
  await db.query(`UPDATE competitions SET featured_rank = $2, tier = $3, country = $4 WHERE id = $1`,
    [compId, opts.featured ?? null, opts.tier ?? null, opts.country ?? 'ES']);
  const seasonId = await crearTemporada(compId);
  return { compId, seasonId };
}

describe('GET /matches/current?scope=feed', () => {
  it('destacada sin seguirla; pequeña fuera (contada en hiddenCount); sin directo también sale', async () => {
    const okLiga = await competicion({ featured: 1, tier: 1 });
    const pequena = await competicion({ tier: 4 });
    const destacado = await crearPartido({ seasonId: okLiga.seasonId, status: 'scheduled', horasDesdeInicio: -3 });
    await crearPartido({ seasonId: pequena.seasonId, status: 'live', horasDesdeInicio: 0 });

    const r = await get('/current?scope=feed');
    expect(r.matches.map((m) => m.id)).toEqual([destacado.matchId]);
    expect(r.hiddenCount).toBe(1);
  });

  it('competición pequeña seguida y equipo seguido de otra pequeña: aparecen, sin duplicados', async () => {
    const pequena = await competicion({ tier: 4 });
    const otra = await competicion({ tier: 5 });
    const p1 = await crearPartido({ seasonId: pequena.seasonId });
    const p2 = await crearPartido({ seasonId: otra.seasonId });

    const r = await get(`/current?scope=feed&leagues=${pequena.compId}&teams=${p2.homeTeamId},${p1.homeTeamId}`);
    expect(r.matches.map((m) => m.id).sort()).toEqual([p1.matchId, p2.matchId].sort());
    expect(r.hiddenCount).toBe(0);
  });

  it('dejar de seguir la competición la saca, salvo que siga a uno de sus equipos', async () => {
    const pequena = await competicion({ tier: 4 });
    const p = await crearPartido({ seasonId: pequena.seasonId });
    expect((await get('/current?scope=feed')).matches).toHaveLength(0);
    expect((await get(`/current?scope=feed&teams=${p.awayTeamId}`)).matches.map((m) => m.id)).toEqual([p.matchId]);
  });

  it('país preferido: la destacada de segundo nivel de otro país se queda fuera; la de primer nivel no', async () => {
    const plataPt = await competicion({ featured: 30, tier: 2, country: 'PT' });
    const placard = await competicion({ featured: 2, tier: 1, country: 'PT' });
    await crearPartido({ seasonId: plataPt.seasonId });
    const top = await crearPartido({ seasonId: placard.seasonId });
    const r = await get('/current?scope=feed&country=ES');
    expect(r.matches.map((m) => m.id)).toEqual([top.matchId]);
    expect(r.hiddenCount).toBe(1);
  });

  it('scope=following: solo lo seguido; sin scope, todo como siempre', async () => {
    const dest = await competicion({ featured: 1, tier: 1 });
    const pequena = await competicion({ tier: 4 });
    await crearPartido({ seasonId: dest.seasonId });
    const p = await crearPartido({ seasonId: pequena.seasonId });
    expect((await get(`/current?scope=following&leagues=${pequena.compId}`)).matches.map((m) => m.id)).toEqual([p.matchId]);
    expect((await get('/current')).matches).toHaveLength(2);
  });

});

describe('enlace de retransmisión en el listado', () => {
  it('/matches/current y /matches/live traen videoUrl (el listado pinta la tele)', async () => {
    const dest = await competicion({ featured: 1, tier: 1 });
    const { matchId } = await crearPartido({ seasonId: dest.seasonId, status: 'live' });
    await db.query(`UPDATE matches SET video_url = 'https://www.youtube.com/watch?v=x' WHERE id = $1`, [matchId]);
    const sinVideo = await crearPartido({ seasonId: dest.seasonId });
    const cur = await get('/current') as unknown as { matches: Array<{ id: string; videoUrl: string | null }> };
    expect(cur.matches.find((m) => m.id === matchId)!.videoUrl).toBe('https://www.youtube.com/watch?v=x');
    expect(cur.matches.find((m) => m.id === sinVideo.matchId)!.videoUrl).toBeNull();
    const live = await get('/live') as unknown as { matches: Array<{ id: string; videoUrl: string | null }> };
    expect(live.matches.find((m) => m.id === matchId)!.videoUrl).toBe('https://www.youtube.com/watch?v=x');
  });
});
