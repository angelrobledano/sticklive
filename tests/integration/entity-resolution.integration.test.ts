/**
 * Fase 1 — embudo determinista de resolución de entidades.
 *
 * Verifica los escalones del RefResolver contra Postgres real: source_entity_map
 * (escalón 1), el puente que lo alimenta, y team_aliases normalizado (escalón 2),
 * más la idempotencia del backfill de aliases.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  db, closeDb,
  resolveTeamViaSourceMap,
  upsertSourceEntityMapTeam,
  upsertTeamAlias,
} from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearFuente, crearEquipo } from './support/factorias.js';
import { RefResolver } from '../../apps/etl/src/loaders/ref-resolver.js';
import { backfillTeamAliases } from '../../apps/etl/src/backfill-team-aliases.js';
import { normalizeTeamName } from '../../apps/etl/src/transformers/normalize.js';

let sportId: string;
let sourceId: string;
let seq = 0;

async function crearEquipoConFuente(sourceRef: string): Promise<string> {
  seq += 1;
  const slug = `er-team-${seq}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO teams (sport_id, name, slug, source_id, source_ref)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [sportId, slug, slug, sourceId, sourceRef],
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

describe('Fase 1 — RefResolver (embudo determinista)', () => {
  it('escalón 1: resuelve por source_entity_map', async () => {
    const teamId = await crearEquipoConFuente('fep_team_1');
    await upsertSourceEntityMapTeam(sourceId, 'fep_team_1', teamId);

    const resolver = new RefResolver(sportId);
    expect(await resolver.resolveTeam('fep_team_1', sourceId)).toBe(teamId);
    expect(await resolveTeamViaSourceMap('fep_team_1', sourceId)).toBe(teamId);
  });

  it('el puente (source_ref) alimenta source_entity_map para la próxima vez', async () => {
    const teamId = await crearEquipoConFuente('fep_team_2'); // sin fila en el mapa
    expect(await resolveTeamViaSourceMap('fep_team_2', sourceId)).toBeNull();

    const resolver = new RefResolver(sportId);
    // Resuelve por el puente (teams.source_ref)...
    expect(await resolver.resolveTeam('fep_team_2', sourceId)).toBe(teamId);
    // ...y de paso ha alimentado el mapa (escalón 1) para la siguiente.
    expect(await resolveTeamViaSourceMap('fep_team_2', sourceId)).toBe(teamId);
  });

  it('escalón 2: resuelve por alias normalizado cuando el nombre no se parece al del team', async () => {
    // Nombre del team lejano al ref consultado → la similitud NO lo pillaría.
    const teamId = await crearEquipo(sportId, 'HC Corunha');
    await upsertTeamAlias({
      teamId, rawText: 'Deportivo Liceo', normalized: 'liceo', createdBy: 'deterministic',
    });

    const resolver = new RefResolver(sportId);
    expect(await resolver.resolveTeam('Liceo')).toBe(teamId);
  });

  it('un ref desconocido sin candidato razonable lanza error (no inventa)', async () => {
    const resolver = new RefResolver(sportId);
    await expect(resolver.resolveTeam('zzz-inexistente-qwerty')).rejects.toThrow(/No se encontró equipo/);
  });

  it('el backfill de aliases es idempotente y alimenta el escalón 2', async () => {
    const teamId = await crearEquipo(sportId, 'Coinasa Liceo');

    const r1 = await backfillTeamAliases();
    expect(r1.aliasCreados).toBeGreaterThan(0);

    const r2 = await backfillTeamAliases();
    expect(r2.aliasCreados).toBe(0); // idempotente

    // El alias determinista resuelve por el escalón 2.
    const resolver = new RefResolver(sportId);
    expect(await resolver.resolveTeam(normalizeTeamName('Coinasa Liceo'))).toBe(teamId);
  });
});
