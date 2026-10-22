/**
 * B2 — Zonas de clasificación (migración 085).
 */
import { db, withTransaction } from '../client.js';
import type { StandingsZone } from '@sports/shared-types';

export async function getStandingsZones(seasonId: string): Promise<StandingsZone[]> {
  const r = await db.query<StandingsZone>(
    `SELECT kind, pos_from AS "posFrom", pos_to AS "posTo", target,
            phase_id AS "phaseId", group_name AS "groupName"
       FROM standings_zones WHERE season_id = $1
      ORDER BY pos_from, pos_to`,
    [seasonId],
  );
  return r.rows;
}

/** Reemplaza todas las zonas de una temporada. La fuente normativa es obligatoria. */
export async function replaceStandingsZones(seasonId: string, zones: StandingsZone[], sourceNote: string): Promise<void> {
  if (!sourceNote.trim()) throw new Error('replaceStandingsZones: falta la fuente normativa');
  await withTransaction(async (c) => {
    await c.query(`DELETE FROM standings_zones WHERE season_id = $1`, [seasonId]);
    for (const z of zones) {
      await c.query(
        `INSERT INTO standings_zones (season_id, phase_id, group_name, kind, pos_from, pos_to, target, source_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [seasonId, z.phaseId, z.groupName, z.kind, z.posFrom, z.posTo, z.target, sourceNote],
      );
    }
  });
}

/**
 * Copia las zonas de otra temporada (punto de partida al abrir una nueva).
 * Las ligadas a una fase concreta no se copian: las fases son de cada temporada.
 */
export async function copyStandingsZones(fromSeasonId: string, toSeasonId: string): Promise<number> {
  const r = await db.query(
    `INSERT INTO standings_zones (season_id, group_name, kind, pos_from, pos_to, target, source_note)
     SELECT $2, group_name, kind, pos_from, pos_to, target, source_note || ' (copiada de la temporada anterior: revisar)'
       FROM standings_zones WHERE season_id = $1 AND phase_id IS NULL`,
    [fromSeasonId, toSeasonId],
  );
  return r.rowCount ?? 0;
}
