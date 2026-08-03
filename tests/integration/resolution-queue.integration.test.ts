/**
 * Fase 2 — fuzzy con bloqueo (escalón 3) + cola HITL (escalón 4).
 *
 * Verifica que el fuzzy propone candidatos por trigram y que lo no resuelto por
 * los escalones deterministas se APARCA en resolution_queue (sin auto-confirmar),
 * contra Postgres real.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  db, closeDb,
  upsertTeamAlias,
  generateFuzzyCandidates,
  enqueueResolution,
} from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearFuente, crearEquipo } from './support/factorias.js';
import { RefResolver } from '../../apps/etl/src/loaders/ref-resolver.js';
import { normalizeTeamName } from '../../apps/etl/src/transformers/normalize.js';

let sportId: string;
let sourceId: string;

async function contarCola(where = ''): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM resolution_queue ${where}`,
  );
  return Number(rows[0]!.n);
}

beforeEach(async () => {
  await limpiar();
  sportId = await crearDeporte();
  sourceId = await crearFuente('fep_hockey');
});

afterAll(async () => {
  await closeDb();
});

describe('Fase 2 — fuzzy + cola HITL', () => {
  it('escalón 3: genera candidatos por trigram, acotado por deporte', async () => {
    const teamId = await crearEquipo(sportId, 'Deportivo Liceo');
    await upsertTeamAlias({
      teamId, rawText: 'Deportivo Liceo', normalized: 'liceo', createdBy: 'deterministic',
    });

    const exactos = await generateFuzzyCandidates('liceo', sportId, 3);
    expect(exactos[0]?.teamId).toBe(teamId);
    expect(exactos[0]!.score).toBeCloseTo(1, 1);

    // Un nombre parecido sigue proponiéndolo como candidato.
    const parecidos = await generateFuzzyCandidates('liceos', sportId, 3);
    expect(parecidos.map((c) => c.teamId)).toContain(teamId);
  });

  it('escalón 4: un ref no resuelto se encola (sin auto-confirmar) y lanza error', async () => {
    const resolver = new RefResolver(sportId);
    await expect(resolver.resolveTeam('Equipo Fantasma XYZ', sourceId))
      .rejects.toThrow(/No se encontró equipo/);

    const norm = normalizeTeamName('Equipo Fantasma XYZ');
    const { rows } = await db.query<{ normalized: string; occurrences: number; status: string }>(
      `SELECT normalized, occurrences, status FROM resolution_queue WHERE source_id = $1`,
      [sourceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.normalized).toBe(norm);
    expect(rows[0]!.occurrences).toBe(1);
    expect(rows[0]!.status).toBe('pending');
  });

  it('reencolar el mismo ref incrementa occurrences (una entrada, no una por partido)', async () => {
    const resolver = new RefResolver(sportId);
    await resolver.resolveTeam('Equipo Fantasma XYZ', sourceId).catch(() => {});
    // Nueva instancia para saltar la caché en memoria.
    await new RefResolver(sportId).resolveTeam('Equipo Fantasma XYZ', sourceId).catch(() => {});

    expect(await contarCola(`WHERE source_id = '${sourceId}'`)).toBe(1);
    const { rows } = await db.query<{ occurrences: number }>(
      `SELECT occurrences FROM resolution_queue WHERE source_id = $1`, [sourceId],
    );
    expect(rows[0]!.occurrences).toBe(2);
  });

  it('no vuelve a tocar un ítem ya resuelto por un humano', async () => {
    await enqueueResolution({
      rawText: 'X', normalized: 'x', sourceId, candidates: [],
    });
    await db.query(`UPDATE resolution_queue SET status = 'resolved' WHERE normalized = 'x'`);

    // Reencolar el mismo: no incrementa ni revive.
    await enqueueResolution({ rawText: 'X', normalized: 'x', sourceId, candidates: [] });

    const { rows } = await db.query<{ occurrences: number; status: string }>(
      `SELECT occurrences, status FROM resolution_queue WHERE normalized = 'x'`,
    );
    expect(rows[0]!.occurrences).toBe(1);
    expect(rows[0]!.status).toBe('resolved');
  });

  it('sin sourceId no se puede encolar: lanza sin crear fila', async () => {
    const resolver = new RefResolver(sportId);
    await expect(resolver.resolveTeam('Otro Fantasma')).rejects.toThrow(/No se encontró equipo/);
    expect(await contarCola()).toBe(0);
  });
});
