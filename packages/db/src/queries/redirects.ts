import pg from 'pg';
import { db } from '../client.js';

/**
 * Memoria de bajas y fusiones de fichas públicas (migración 073, F1-7).
 *
 * El trigger de la 073 registra todo borrado con `new_id` NULL. Quien sabe a
 * qué entidad sustituye la borrada (fusión, sintético adoptado) lo apunta con
 * `recordEntityRedirect`, y la web responde 308 a esa entidad en vez de 404.
 */

export type RedirectEntityType = 'competition' | 'team' | 'player' | 'match';

export const REDIRECT_ENTITY_TYPES: readonly RedirectEntityType[] = ['competition', 'team', 'player', 'match'];

const TABLE: Record<RedirectEntityType, string> = {
  competition: 'competitions',
  team: 'teams',
  player: 'players',
  match: 'matches',
};

/** Cadena máxima a seguir: evita bucles si alguien escribe A→B y B→A a mano. */
const MAX_HOPS = 10;

/**
 * Apunta que `oldId` (ya borrado o a punto de borrarse) lo sustituye `newId`.
 * Upsert: si el trigger ya lo registró como baja sin sustituto, se completa.
 */
export async function recordEntityRedirect(
  type: RedirectEntityType,
  oldId: string,
  newId: string | null,
  reason: string,
  client: pg.PoolClient | typeof db = db
): Promise<void> {
  await client.query(
    `INSERT INTO entity_redirects (entity_type, old_id, new_id, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (entity_type, old_id)
     DO UPDATE SET new_id = EXCLUDED.new_id, reason = EXCLUDED.reason, created_at = NOW()`,
    [type, oldId, newId, reason]
  );
}

export type EntityRedirectResolution =
  | { status: 'moved'; newId: string }
  | { status: 'gone' }
  | null;

/**
 * Resuelve a dónde debe ir una ficha que ya no existe.
 *  · `null`  → no hay registro: el id nunca existió (o se borró antes de la 073).
 *  · `gone`  → existió y no tiene sustituto vivo.
 *  · `moved` → el sustituto vivo al final de la cadena.
 */
export async function resolveEntityRedirect(
  type: RedirectEntityType,
  id: string
): Promise<EntityRedirectResolution> {
  let current = id;
  let found = false;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const { rows } = await db.query<{ new_id: string | null }>(
      `SELECT new_id FROM entity_redirects WHERE entity_type = $1 AND old_id = $2`,
      [type, current]
    );
    const row = rows[0];
    if (!row) break;
    found = true;
    if (!row.new_id) return { status: 'gone' };
    current = row.new_id;
  }
  if (!found) return null;

  const alive = await db.query(`SELECT 1 FROM ${TABLE[type]} WHERE id = $1`, [current]);
  return (alive.rowCount ?? 0) > 0 ? { status: 'moved', newId: current } : { status: 'gone' };
}
