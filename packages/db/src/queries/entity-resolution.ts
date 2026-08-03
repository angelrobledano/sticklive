/**
 * Consultas del embudo de resolución de entidades (Fase 1).
 *
 * Escalón 1 — `source_entity_map`: ID de fuente → team (determinista).
 * Escalón 2 — `team_aliases`: nombre normalizado → team (caché exacta).
 *
 * Estas funciones son sólo lectura/escritura puntual; la cascada de decisión
 * vive en el ETL (apps/etl/src/loaders/ref-resolver.ts). Ver
 * docs/ARQUITECTURA_ENTITY_RESOLUTION.md §3.
 */
import pg from 'pg';
import { db } from '../client.js';

type Ejecutor = pg.PoolClient | typeof db;

/**
 * Escalón 1: resuelve un ref de fuente a team_id vía `source_entity_map`.
 * Si se pasa `sourceId`, respeta la clave (source_id, source_ref); si no, busca
 * por ref en cualquier fuente (útil para refs globalmente únicos como los FEP).
 */
export async function resolveTeamViaSourceMap(
  sourceRef: string,
  sourceId?: string,
): Promise<string | null> {
  const { rows } = sourceId
    ? await db.query<{ team_id: string }>(
        `SELECT team_id FROM source_entity_map
          WHERE source_id = $2 AND source_ref = $1 AND team_id IS NOT NULL
          LIMIT 1`,
        [sourceRef, sourceId],
      )
    : await db.query<{ team_id: string }>(
        `SELECT team_id FROM source_entity_map
          WHERE source_ref = $1 AND team_id IS NOT NULL
          LIMIT 1`,
        [sourceRef],
      );
  return rows[0]?.team_id ?? null;
}

/**
 * Alimenta el escalón 1: registra (fuente, ref) → team. Idempotente; no pisa un
 * mapeo existente (ON CONFLICT DO NOTHING). Best-effort desde el ETL.
 */
export async function upsertSourceEntityMapTeam(
  sourceId: string,
  sourceRef: string,
  teamId: string,
  client: Ejecutor = db,
): Promise<void> {
  await client.query(
    `INSERT INTO source_entity_map (source_id, source_ref, team_id)
          VALUES ($1, $2, $3)
     ON CONFLICT (source_id, source_ref) DO NOTHING`,
    [sourceId, sourceRef, teamId],
  );
}

/**
 * Escalón 2: nombre normalizado → team_id, match EXACTO sobre `team_aliases`.
 * Sólo aliases `confirmed`. Con `sourceId`, prioriza el de la misma fuente.
 */
export async function findTeamByNormalizedAlias(
  normalized: string,
  sourceId?: string,
): Promise<string | null> {
  const { rows } = await db.query<{ team_id: string }>(
    `SELECT team_id FROM team_aliases
      WHERE normalized = $1 AND status = 'confirmed'
      ORDER BY ($2::uuid IS NOT NULL AND source_id = $2) DESC NULLS LAST,
               confidence DESC
      LIMIT 1`,
    [normalized, sourceId ?? null],
  );
  return rows[0]?.team_id ?? null;
}

export interface UpsertTeamAliasInput {
  teamId: string;
  rawText: string;
  normalized: string;
  sourceId?: string | null;
  createdBy: string;            // 'deterministic' | 'fuzzy' | 'llm' | 'human:<user>'
  confidence?: number;
  status?: 'confirmed' | 'pending' | 'rejected';
}

/**
 * Alimenta el escalón 2. Idempotente por (normalized, source_id): no duplica ni
 * pisa un alias existente. Best-effort desde el ETL/backfill.
 */
export async function upsertTeamAlias(
  input: UpsertTeamAliasInput,
  client: Ejecutor = db,
): Promise<void> {
  await client.query(
    `INSERT INTO team_aliases (team_id, raw_text, normalized, source_id, confidence, status, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (normalized, source_id) DO NOTHING`,
    [
      input.teamId,
      input.rawText,
      input.normalized,
      input.sourceId ?? null,
      input.confidence ?? 1.0,
      input.status ?? 'confirmed',
      input.createdBy,
    ],
  );
}
