/**
 * Fases de competición y sus rondas (migración 072).
 *
 *   Competition → Season → Phase → (Group) → Round → Match
 *
 * Lo usan las cargas de calendario de TODAS las fuentes: el plan de estructura
 * (`planSourceStructure`, en @sports/shared-types) decide las fases/rondas a
 * partir de lo que publica la fuente, y estas funciones lo persisten de forma
 * idempotente.
 *
 * Adopción de lo legado: las temporadas existentes tienen fases `legacy`
 * (backfill de 072) y rondas antiguas. La primera carga estructurada ADOPTA
 * esas filas en lugar de crear otras en paralelo: así un partido conserva su
 * ronda/fase (y sus ids) y no quedan rondas vacías huérfanas.
 */
import pg from 'pg';
import { db } from '../client.js';
import type { KnockoutStage, PhaseKind, StructureEvidence } from '@sports/shared-types';

type Client = pg.PoolClient | typeof db;

export interface EnsurePhaseInput {
  seasonId: string;
  /** Id de fase en la fuente (`fep_fase_3483`). */
  sourceRef: string;
  kind: PhaseKind;
  isPlacement: boolean;
  name: string | null;
  ordinal: number;
  resolvedBy: StructureEvidence;
  sourceId?: string | null;
}

/**
 * Get-or-create de una fase por (temporada, ref de la fuente). Si no existe pero
 * la temporada tiene una fase `legacy` del mismo tipo sin adoptar, se adopta.
 * La fuente es la autoridad de la estructura: en cada carga se refrescan tipo,
 * nombre y orden.
 */
export async function ensurePhase(input: EnsurePhaseInput, client: Client = db): Promise<string> {
  const values = [input.kind, input.isPlacement, input.name, input.ordinal, input.resolvedBy, input.sourceId ?? null];

  const existing = await client.query<{ id: string }>(
    `UPDATE phases SET kind = $3, is_placement = $4, name = COALESCE($5, name),
                       ordinal = $6, resolved_by = $7, source_id = COALESCE($8, source_id)
      WHERE season_id = $1 AND source_ref = $2
      RETURNING id`,
    [input.seasonId, input.sourceRef, ...values],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  // Adopción de la fase legada equivalente (liga↔grupos cuentan como liguilla).
  const roundRobin = input.kind === 'league' || input.kind === 'groups';
  const adopted = await client.query<{ id: string }>(
    `UPDATE phases SET source_ref = $2, kind = $3, is_placement = $4, name = COALESCE($5, name),
                       ordinal = $6, resolved_by = $7, source_id = COALESCE($8, source_id)
      WHERE id = (
        SELECT id FROM phases
         WHERE season_id = $1 AND resolved_by = 'legacy' AND source_ref IS NULL
           AND ${roundRobin ? `kind IN ('league', 'groups')` : `kind = 'knockout'`}
         ORDER BY ordinal LIMIT 1
      )
      RETURNING id`,
    [input.seasonId, input.sourceRef, ...values],
  );
  if (adopted.rows[0]) return adopted.rows[0].id;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO phases (season_id, source_ref, kind, is_placement, name, ordinal, resolved_by, source_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (season_id, source_ref) WHERE source_ref IS NOT NULL DO UPDATE SET
       kind = EXCLUDED.kind, is_placement = EXCLUDED.is_placement,
       name = COALESCE(EXCLUDED.name, phases.name), ordinal = EXCLUDED.ordinal,
       resolved_by = EXCLUDED.resolved_by
     RETURNING id`,
    [input.seasonId, input.sourceRef, ...values],
  );
  return inserted.rows[0]!.id;
}

export interface EnsurePhaseRoundInput {
  seasonId: string;
  phaseId: string;
  roundType: 'regular' | 'playoff';
  /** Jornada (liga/grupos) u orden de la fase eliminatoria dentro de la fase. */
  number: number;
  stage: KnockoutStage | null;
  name: string | null;
  sourceId?: string | null;
}

/**
 * Get-or-create de una ronda dentro de su fase. Orden de búsqueda:
 *   1. misma fase + número + tipo (identidad);
 *   2. misma fase + misma fase eliminatoria (no colocación: puede haber varias);
 *   3. misma fase + mismo nombre (rondas legadas con otra numeración);
 *   4. ronda legada SIN fase con la misma identidad antigua (temporada+número+tipo);
 *   5. alta.
 */
export async function ensurePhaseRound(input: EnsurePhaseRoundInput, client: Client = db): Promise<string> {
  const { seasonId, phaseId, roundType, number, stage, name } = input;

  const byIdentity = await client.query<{ id: string }>(
    `UPDATE rounds SET stage = COALESCE($5, stage), name = COALESCE(name, $6)
      WHERE season_id = $1 AND phase_id = $2 AND number = $3 AND round_type = $4
      RETURNING id`,
    [seasonId, phaseId, number, roundType, stage, name],
  );
  if (byIdentity.rows[0]) return byIdentity.rows[0].id;

  if (stage && stage !== 'placement') {
    const byStage = await client.query<{ id: string }>(
      `UPDATE rounds SET name = COALESCE(name, $4)
        WHERE id = (SELECT id FROM rounds WHERE season_id = $1 AND phase_id = $2 AND stage = $3
                     ORDER BY number LIMIT 1)
        RETURNING id`,
      [seasonId, phaseId, stage, name],
    );
    if (byStage.rows[0]) return byStage.rows[0].id;
  }

  if (name) {
    const byName = await client.query<{ id: string }>(
      `UPDATE rounds SET stage = COALESCE(stage, $5)
        WHERE id = (SELECT id FROM rounds
                     WHERE season_id = $1 AND phase_id = $2 AND round_type = $3
                       AND lower(name) = lower($4) AND (stage IS NULL OR stage = $5 OR $5 IS NULL)
                     ORDER BY number LIMIT 1)
        RETURNING id`,
      [seasonId, phaseId, roundType, name, stage],
    );
    if (byName.rows[0]) return byName.rows[0].id;
  }

  const orphan = await client.query<{ id: string }>(
    `UPDATE rounds SET phase_id = $2, stage = COALESCE(stage, $5), name = COALESCE(name, $6)
      WHERE season_id = $1 AND phase_id IS NULL AND number = $3 AND round_type = $4
      RETURNING id`,
    [seasonId, phaseId, number, roundType, stage, name],
  );
  if (orphan.rows[0]) return orphan.rows[0].id;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO rounds (season_id, phase_id, number, name, round_type, stage, source_id, scraped_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (season_id, phase_id, number, round_type) DO UPDATE SET
       stage = COALESCE(EXCLUDED.stage, rounds.stage),
       name  = COALESCE(rounds.name, EXCLUDED.name),
       updated_at = NOW()
     RETURNING id`,
    [seasonId, phaseId, number, name, roundType, stage, input.sourceId ?? null],
  );
  return inserted.rows[0]!.id;
}

/** Fila de fase tal y como la consumen API y ETL. */
export interface DbPhase {
  id: string;
  season_id: string;
  ordinal: number;
  kind: PhaseKind;
  is_placement: boolean;
  name: string | null;
  resolved_by: StructureEvidence | 'legacy';
  source_ref: string | null;
}

export async function getSeasonPhases(seasonId: string, client: Client = db): Promise<DbPhase[]> {
  const res = await client.query<DbPhase>(
    `SELECT id, season_id, ordinal, kind, is_placement, name, resolved_by, source_ref
       FROM phases WHERE season_id = $1
      ORDER BY ordinal, created_at`,
    [seasonId],
  );
  return res.rows;
}
