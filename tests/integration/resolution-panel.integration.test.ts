/**
 * Fase 2b — panel HITL (lectura + resolución de la cola).
 *
 * Verifica listar por impacto, resolver (marca + aprende alias) y descartar,
 * contra Postgres real.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  db, closeDb,
  enqueueResolution,
  listResolutionQueue,
  resolveQueueItem,
  rejectQueueItem,
  findTeamByNormalizedAlias,
} from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearFuente, crearEquipo } from './support/factorias.js';

let sportId: string;
let sourceId: string;

async function idDe(normalized: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM resolution_queue WHERE normalized = $1`, [normalized],
  );
  return rows[0]!.id;
}

beforeEach(async () => {
  await limpiar();
  sportId = await crearDeporte();
  sourceId = await crearFuente('fep_hockey');
});

afterAll(async () => {
  await closeDb();
});

describe('Fase 2b — panel de la cola de resolución', () => {
  it('lista los pendientes ordenados por occurrences (impacto)', async () => {
    await enqueueResolution({ rawText: 'Uno', normalized: 'uno', sourceId, candidates: [] });
    await enqueueResolution({ rawText: 'Dos', normalized: 'dos', sourceId, candidates: [] });
    // "dos" se ve dos veces más → debe salir primero.
    await enqueueResolution({ rawText: 'Dos', normalized: 'dos', sourceId, candidates: [] });

    const items = await listResolutionQueue('pending', 100);
    expect(items).toHaveLength(2);
    expect(items[0]!.normalized).toBe('dos');
    expect(items[0]!.occurrences).toBe(2);
  });

  it('resolver marca resuelto, aprende el alias y es idempotente', async () => {
    const teamId = await crearEquipo(sportId, 'Deportivo Liceo');
    await enqueueResolution({ rawText: 'Liceo', normalized: 'liceo', sourceId, candidates: [] });
    const id = await idDe('liceo');

    const res = await resolveQueueItem(id, teamId, 'human:test');
    expect(res).toEqual({ id, teamId });

    // El ítem queda resuelto y ya no aparece en la bandeja.
    expect(await listResolutionQueue('pending')).toHaveLength(0);
    const { rows } = await db.query<{ status: string; resolved_team_id: string }>(
      `SELECT status, resolved_team_id FROM resolution_queue WHERE id = $1`, [id],
    );
    expect(rows[0]!.status).toBe('resolved');
    expect(rows[0]!.resolved_team_id).toBe(teamId);

    // Aprendizaje: el alias existe → el escalón 2 resolvería 'liceo' solo.
    expect(await findTeamByNormalizedAlias('liceo', sourceId)).toBe(teamId);

    // Idempotente: volver a resolver el mismo ítem no hace nada.
    expect(await resolveQueueItem(id, teamId)).toBeNull();
  });

  it('descartar marca rejected y no crea alias; descartar dos veces es no-op', async () => {
    await enqueueResolution({ rawText: 'Ruido', normalized: 'ruido', sourceId, candidates: [] });
    const id = await idDe('ruido');

    expect(await rejectQueueItem(id)).toBe(true);
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM resolution_queue WHERE id = $1`, [id],
    );
    expect(rows[0]!.status).toBe('rejected');
    expect(await findTeamByNormalizedAlias('ruido', sourceId)).toBeNull();

    // Ya no está pending → segundo reject es no-op.
    expect(await rejectQueueItem(id)).toBe(false);
  });
});
