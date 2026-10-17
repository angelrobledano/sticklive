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
  | { status: 'hidden'; since: string | null }
  | null;

/**
 * Resuelve a dónde debe ir una ficha que ya no existe.
 *  · `null`  → no hay registro: el id nunca existió (o se borró antes de la 073).
 *  · `gone`  → existió y no tiene sustituto vivo.
 *  · `moved` → el sustituto vivo al final de la cadena.
 *  · `hidden` → existe pero está oculta por calidad (`en_revision`, 064/067);
 *    `since` es cuándo se ocultó (075) o null si fue antes de registrarlo.
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
  if (!found) return hiddenByQuality(type, id);

  const alive = await db.query(`SELECT 1 FROM ${TABLE[type]} WHERE id = $1`, [current]);
  return (alive.rowCount ?? 0) > 0 ? { status: 'moved', newId: current } : { status: 'gone' };
}

/**
 * Momento de la ocultación cuando varias banderas ocultan a la vez: la más
 * reciente (la revisión dura desde la última). Si alguna no tiene fecha (oculta
 * antes de la 075), null: no se sabe desde cuándo, se trata como revisión larga.
 */
function hiddenSince(dates: Array<Date | null>): string | null {
  if (dates.length === 0 || dates.some((d) => d === null)) return null;
  const max = Math.max(...dates.map((d) => (d as Date).getTime()));
  return new Date(max).toISOString();
}

/**
 * ¿La entidad existe pero está oculta por calidad? (F1-6). Solo partidos y
 * competiciones se ocultan enteros: equipos y jugadores siguen visibles con
 * las temporadas ocultas filtradas.
 */
async function hiddenByQuality(type: RedirectEntityType, id: string): Promise<EntityRedirectResolution> {
  if (type === 'match') {
    const { rows } = await db.query<{ s_ok: boolean; s_t: Date | null; c_ok: boolean; c_t: Date | null }>(
      `SELECT s.data_quality = 'ok' AS s_ok, s.data_quality_changed_at AS s_t,
              c.data_quality = 'ok' AS c_ok, c.data_quality_changed_at AS c_t
         FROM matches m
         JOIN seasons s      ON s.id = m.season_id
         JOIN competitions c ON c.id = s.competition_id
        WHERE m.id = $1`,
      [id]
    );
    const r = rows[0];
    if (!r || (r.s_ok && r.c_ok)) return null;
    const dates: Array<Date | null> = [];
    if (!r.s_ok) dates.push(r.s_t);
    if (!r.c_ok) dates.push(r.c_t);
    return { status: 'hidden', since: hiddenSince(dates) };
  }

  if (type === 'competition') {
    const { rows } = await db.query<{ c_ok: boolean; c_t: Date | null; seasons: number; visible: number; hidden_t: Array<Date | null> | null }>(
      `SELECT c.data_quality = 'ok' AS c_ok, c.data_quality_changed_at AS c_t,
              count(s.id)::int AS seasons,
              (count(s.id) FILTER (WHERE s.data_quality = 'ok'))::int AS visible,
              array_agg(s.data_quality_changed_at) FILTER (WHERE s.data_quality <> 'ok') AS hidden_t
         FROM competitions c
         LEFT JOIN seasons s ON s.competition_id = c.id
        WHERE c.id = $1
        GROUP BY c.id`,
      [id]
    );
    const r = rows[0];
    if (!r) return null;
    if (!r.c_ok) return { status: 'hidden', since: hiddenSince([r.c_t]) };
    if (r.seasons > 0 && r.visible === 0) return { status: 'hidden', since: hiddenSince(r.hidden_t ?? []) };
    return null;
  }

  return null;
}
