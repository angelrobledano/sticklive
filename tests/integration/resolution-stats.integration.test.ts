/**
 * Punto 3 — salud del embudo (métrica arch §5.3).
 *
 * getResolutionStats agrega el backlog de la cola (pending + occurrences) y el
 * aprendizaje (aliases por origen). Verificado contra Postgres real.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  db, closeDb,
  upsertTeamAlias,
  enqueueResolution,
  resolveQueueItem,
  getResolutionStats,
} from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearFuente, crearEquipo } from './support/factorias.js';

let sportId: string;
let sourceId: string;

beforeEach(async () => {
  await limpiar();
  sportId = await crearDeporte();
  sourceId = await crearFuente('fep_hockey');
});

afterAll(async () => {
  await closeDb();
});

describe('Punto 3 — getResolutionStats', () => {
  it('agrega backlog de la cola y aprendizaje por origen', async () => {
    const t1 = await crearEquipo(sportId, 'Uno');
    const t2 = await crearEquipo(sportId, 'Dos');
    await upsertTeamAlias({ teamId: t1, rawText: 'Uno', normalized: 'uno', sourceId, createdBy: 'deterministic' });
    await upsertTeamAlias({ teamId: t2, rawText: 'Dos', normalized: 'dos', sourceId, createdBy: 'deterministic' });
    await upsertTeamAlias({ teamId: t1, rawText: 'Un0', normalized: 'un0', sourceId, createdBy: 'fuzzy' });

    await enqueueResolution({ rawText: 'A', normalized: 'a', sourceId, candidates: [] });
    await enqueueResolution({ rawText: 'B', normalized: 'b', sourceId, candidates: [] });
    await enqueueResolution({ rawText: 'B', normalized: 'b', sourceId, candidates: [] }); // occ 2
    await enqueueResolution({ rawText: 'C', normalized: 'c', sourceId, candidates: [] });

    const cId = (await db.query<{ id: string }>(`SELECT id FROM resolution_queue WHERE normalized='c'`)).rows[0]!.id;
    await resolveQueueItem(cId, t2, 'human:test'); // → resolved + alias humano 'c'

    const s = await getResolutionStats();

    expect(s.queue.pending).toBe(2);            // a, b
    expect(s.queue.resolved).toBe(1);           // c
    expect(s.queue.rejected).toBe(0);
    expect(s.queue.pendingOccurrences).toBe(3); // a=1 + b=2

    expect(s.aliases.deterministic).toBe(2);
    expect(s.aliases.fuzzy).toBe(1);
    expect(s.aliases.human).toBe(1);            // del resolve de 'c'
    expect(s.aliases.total).toBe(4);
  });

  it('devuelve ceros cuando no hay nada', async () => {
    const s = await getResolutionStats();
    expect(s.queue).toEqual({ pending: 0, resolved: 0, rejected: 0, pendingOccurrences: 0 });
    expect(s.aliases).toEqual({ deterministic: 0, fuzzy: 0, human: 0, total: 0 });
  });
});
