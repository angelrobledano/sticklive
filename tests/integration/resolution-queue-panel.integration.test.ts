/**
 * Cola de equipos del admin: cada ítem dice qué pregunta (nombre sin equipo o
 * posible duplicado) y los candidatos llegan con su ficha para decidir.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, enqueueResolution } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearEquipo, crearFuente } from './support/factorias.js';

process.env['ADMIN_TOKEN'] = 'test-token';
const { adminRouter } = await import('../../apps/api/src/routes/admin.js');

beforeEach(limpiar);
afterAll(closeDb);

describe('GET /admin/resolution-queue', () => {
  it('clasifica los ítems y adjunta la ficha de cada candidato', async () => {
    const sportId = await crearDeporte();
    const sourceId = await crearFuente();
    const a = await crearEquipo(sportId, 'CP CALAFELL');
    const b = await crearEquipo(sportId, 'CALAFELL LA MENORQUINA');
    await db.query(`UPDATE teams SET logo_url = 'https://x/calafell.png', gender = 'male' WHERE id = $1`, [a]);

    await enqueueResolution({
      rawText: 'CALAFELL TOT L ANY', normalized: 'calafell tot l any', sourceId, sourceRef: 'x',
      context: { sportId }, candidates: [{ teamId: a, name: 'CP CALAFELL', score: 0.8 }],
    });
    await db.query(
      `INSERT INTO resolution_queue (raw_text, normalized, source_id, context, candidates) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)`,
      ['A ⇄ B', 'a ⇄ b', sourceId, JSON.stringify({ kind: 'team-duplicate' }),
        JSON.stringify([{ teamId: a, name: 'A', score: 0.8 }, { teamId: b, name: 'B', score: 0.8 }])]);

    const res = await adminRouter.request('/resolution-queue', { headers: { 'x-admin-token': 'test-token' } });
    const body = await res.json() as { items: Array<{ rawText: string; kind: string }>; teams: Record<string, { name: string; logoUrl: string | null; gender: string | null; matches: number }> };
    expect(body.items.map((i) => [i.rawText, i.kind]).sort()).toEqual([['A ⇄ B', 'duplicate'], ['CALAFELL TOT L ANY', 'name']]);
    expect(body.teams[a]).toMatchObject({ name: 'CP CALAFELL', logoUrl: 'https://x/calafell.png', gender: 'male', matches: 0 });
    expect(body.teams[b]?.name).toBe('CALAFELL LA MENORQUINA');
  });
});
