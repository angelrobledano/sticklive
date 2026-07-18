import { db } from '../client.js';
import type { RoundType } from '@sports/shared-types';

export interface UpsertRoundInput {
  seasonId: string;
  number: number;
  name?: string;
  roundType?: RoundType;
  sourceId?: string;
  sourceRef?: string;
}

/**
 * Upsert de ronda/jornada. Clave de conflicto: (season_id, number, round_type),
 * que es la UNIQUE de la tabla. Devuelve el id (UUID).
 *
 * Usado por flujos que generan estructura de fases (p. ej. World Skate:
 * grupos, cuartos, semis, final). El flujo FEP no lo usa por ahora.
 */
export async function upsertRound(input: UpsertRoundInput): Promise<string> {
  const roundType: RoundType = input.roundType ?? 'regular';
  const res = await db.query<{ id: string }>(
    `INSERT INTO rounds (season_id, number, name, round_type, source_id, source_ref, scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     ON CONFLICT (season_id, number, round_type) DO UPDATE SET
       name       = COALESCE(EXCLUDED.name, rounds.name),
       source_ref = COALESCE(EXCLUDED.source_ref, rounds.source_ref),
       updated_at = NOW()
     RETURNING id`,
    [input.seasonId, input.number, input.name ?? null, roundType,
     input.sourceId ?? null, input.sourceRef ?? null]
  );
  return res.rows[0]!.id;
}
