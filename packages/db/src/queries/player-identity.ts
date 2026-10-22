/**
 * B1 — Identidad de persona entre portales (crosswalk).
 *
 * Una persona (`players`) puede tener varias refs de fuente, una por portal
 * (`player_source_refs`). Enlazar dos fichas es SIEMPRE una decisión humana:
 * aquí solo se proponen candidatos, y `linkPlayers` ejecuta el enlace con
 * redirección de la ficha absorbida. Ver migración 084.
 */
import pg from 'pg';
import { db, withTransaction } from '../client.js';
import { recordEntityRedirect } from './redirects.js';

type Ejecutor = pg.PoolClient | typeof db;

/** Persona dueña de una ref de fuente (`fecapa_player_14782`), o null. */
export async function findPlayerIdBySourceRef(sourceRef: string, client: Ejecutor = db): Promise<string | null> {
  const r = await client.query<{ player_id: string }>(
    `SELECT player_id FROM player_source_refs WHERE source_ref = $1
     UNION ALL
     SELECT id FROM players WHERE source_ref = $1
     LIMIT 1`,
    [sourceRef],
  );
  return r.rows[0]?.player_id ?? null;
}

/** Registra una ref para una persona. false si la ref ya es de OTRA persona. */
export async function addPlayerSourceRef(
  playerId: string, sourceRef: string, createdBy: string, client: Ejecutor = db,
): Promise<boolean> {
  await client.query(
    `INSERT INTO player_source_refs (player_id, source_ref, created_by) VALUES ($1, $2, $3)
     ON CONFLICT (source_ref) DO NOTHING`,
    [playerId, sourceRef, createdBy],
  );
  const owner = await client.query<{ player_id: string }>(
    `SELECT player_id FROM player_source_refs WHERE source_ref = $1`, [sourceRef],
  );
  return owner.rows[0]?.player_id === playerId;
}

/** Declara que dos refs son personas distintas (como `forbid` de OKMob). */
export async function forbidPlayerLink(refA: string, refB: string, reason: string, client: Ejecutor = db): Promise<void> {
  const [a, b] = [refA, refB].sort();
  await client.query(
    `INSERT INTO player_link_forbidden (ref_a, ref_b, reason) VALUES ($1, $2, $3)
     ON CONFLICT (ref_a, ref_b) DO UPDATE SET reason = EXCLUDED.reason`,
    [a, b, reason],
  );
}

const FORBIDDEN_BETWEEN_SQL = `
  SELECT 1 FROM player_link_forbidden f
    JOIN player_source_refs ra ON ra.source_ref IN (f.ref_a, f.ref_b)
    JOIN player_source_refs rb ON rb.source_ref IN (f.ref_a, f.ref_b) AND rb.source_ref <> ra.source_ref
   WHERE ra.player_id = $1 AND rb.player_id = $2`;

/**
 * Enlaza `absorbedId` en `keepId`: mueve refs, plantillas, alineaciones,
 * eventos y favoritos, borra la ficha absorbida y deja redirección. Falla si
 * alguna pareja de refs de ambas está prohibida.
 */
export async function linkPlayers(keepId: string, absorbedId: string, by: string): Promise<void> {
  if (keepId === absorbedId) throw new Error('linkPlayers: misma persona');
  await withTransaction(async (c) => {
    const forbidden = await c.query(FORBIDDEN_BETWEEN_SQL, [keepId, absorbedId]);
    if (forbidden.rowCount) throw new Error('linkPlayers: enlace prohibido entre estas refs');

    // La ref principal de la absorbida pasa a ser una ref más de la que queda.
    await c.query(
      `INSERT INTO player_source_refs (player_id, source_ref, created_by)
       SELECT $1, source_ref, $3 FROM players WHERE id = $2 AND source_ref IS NOT NULL
       ON CONFLICT (source_ref) DO UPDATE SET player_id = EXCLUDED.player_id`,
      [keepId, absorbedId, by],
    );
    await c.query(`UPDATE player_source_refs SET player_id = $1 WHERE player_id = $2`, [keepId, absorbedId]);

    // Plantillas: si ya estaba en ese equipo y temporada, sobra la fila.
    await c.query(
      `DELETE FROM team_players a USING team_players k
        WHERE a.player_id = $2 AND k.player_id = $1 AND k.season_id = a.season_id AND k.team_id = a.team_id`,
      [keepId, absorbedId],
    );
    await c.query(`UPDATE team_players SET player_id = $1, updated_at = NOW() WHERE player_id = $2`, [keepId, absorbedId]);
    await c.query(`UPDATE match_lineups SET player_id = $1 WHERE player_id = $2`, [keepId, absorbedId]);
    await c.query(`UPDATE match_events SET player_id = $1 WHERE player_id = $2`, [keepId, absorbedId]);
    await c.query(
      `DELETE FROM user_favorites a USING user_favorites k
        WHERE a.kind = 'player' AND k.kind = 'player' AND a.ref_id = $2 AND k.ref_id = $1 AND a.user_id = k.user_id`,
      [keepId, absorbedId],
    );
    await c.query(`UPDATE user_favorites SET ref_id = $1 WHERE kind = 'player' AND ref_id = $2`, [keepId, absorbedId]);
    await c.query(
      `UPDATE push_subscriptions
          SET fav_players = ARRAY(SELECT DISTINCT unnest(array_replace(fav_players, $2::uuid, $1::uuid)))
        WHERE $2::uuid = ANY(fav_players)`,
      [keepId, absorbedId],
    );
    await c.query(`UPDATE player_link_candidates SET status = 'accepted', resolved_at = NOW()
                    WHERE status = 'pending' AND $1 IN (player_a, player_b) AND $2 IN (player_a, player_b)`, [keepId, absorbedId]);
    await c.query(`DELETE FROM players WHERE id = $1`, [absorbedId]);
    await recordEntityRedirect('player', absorbedId, keepId, `link:${by}`, c);
  });
}

/**
 * Propone candidatos: misma clave de nombre, refs de portales DISJUNTOS (dos
 * fichas del mismo portal con el mismo nombre son homónimos: el portal ya las
 * distingue), sin pares prohibidos. Más puntuación si comparten club. Devuelve
 * cuántos candidatos nuevos se crearon. Nunca enlaza.
 */
export async function generatePlayerLinkCandidates(): Promise<number> {
  const r = await db.query(`
    WITH refs AS (
      SELECT p.id, player_name_key(p.first_name, p.last_name) AS k,
             array_agg(DISTINCT split_part(r.source_ref, '_player_', 1)) AS portals
        FROM players p
        JOIN player_source_refs r ON r.player_id = p.id
       GROUP BY p.id
    ), clubs AS (
      SELECT tp.player_id, array_agg(DISTINCT t.club_id) FILTER (WHERE t.club_id IS NOT NULL) AS club_ids
        FROM team_players tp JOIN teams t ON t.id = tp.team_id
       GROUP BY tp.player_id
    ), pares AS (
      SELECT LEAST(a.id, b.id) AS pa, GREATEST(a.id, b.id) AS pb, a.k,
             a.portals AS portals_a, b.portals AS portals_b,
             COALESCE(ca.club_ids && cb.club_ids, FALSE) AS shared_club
        FROM refs a
        JOIN refs b ON b.k = a.k AND a.id < b.id AND NOT (a.portals && b.portals)
        LEFT JOIN clubs ca ON ca.player_id = a.id
        LEFT JOIN clubs cb ON cb.player_id = b.id
       WHERE length(a.k) > 4
         AND NOT EXISTS (
           SELECT 1 FROM player_link_forbidden f
             JOIN player_source_refs ra ON ra.source_ref IN (f.ref_a, f.ref_b) AND ra.player_id IN (a.id, b.id)
             JOIN player_source_refs rb ON rb.source_ref IN (f.ref_a, f.ref_b) AND rb.player_id IN (a.id, b.id)
                                       AND rb.player_id <> ra.player_id)
    )
    INSERT INTO player_link_candidates (player_a, player_b, score, evidence)
    SELECT pa, pb, CASE WHEN shared_club THEN 0.95 ELSE 0.80 END,
           jsonb_build_object('nameKey', k, 'portalsA', portals_a, 'portalsB', portals_b, 'sharedClub', shared_club)
      FROM pares
    ON CONFLICT (player_a, player_b) DO NOTHING`);
  return r.rowCount ?? 0;
}

/** Un lado del candidato, con lo necesario para decidir en el panel. */
export interface PlayerLinkSide {
  id: string;
  name: string;
  photoUrl: string | null;
  refs: string[];
  /** Equipos por temporada y competición, de la más reciente a la más antigua. */
  teams: { team: string; season: string; competition: string }[];
}

export interface PlayerLinkCandidate {
  id: string;
  playerA: string;
  playerB: string;
  score: number;
  evidence: Record<string, unknown>;
  status: string;
  a: PlayerLinkSide;
  b: PlayerLinkSide;
}

const SIDE_SQL = (col: string) => `
  (SELECT jsonb_build_object(
      'id', p.id,
      'name', p.first_name || ' ' || p.last_name,
      'photoUrl', p.photo_url,
      'refs', COALESCE((SELECT jsonb_agg(r.source_ref ORDER BY r.source_ref) FROM player_source_refs r WHERE r.player_id = p.id), '[]'::jsonb),
      'teams', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('team', x.team, 'season', x.season, 'competition', x.competition)
                         ORDER BY x.start_date DESC NULLS LAST, x.season DESC)
          FROM (SELECT DISTINCT COALESCE(t.display_name, t.name) AS team, se.name AS season,
                       co.name AS competition, se.start_date
                  FROM team_players tp
                  JOIN teams t ON t.id = tp.team_id
                  JOIN seasons se ON se.id = tp.season_id
                  JOIN competitions co ON co.id = se.competition_id
                 WHERE tp.player_id = p.id) x), '[]'::jsonb))
     FROM players p WHERE p.id = c.${col})`;

export async function listPlayerLinkCandidates(status = 'pending', limit = 200): Promise<PlayerLinkCandidate[]> {
  const r = await db.query<PlayerLinkCandidate>(
    `SELECT c.id, c.player_a AS "playerA", c.player_b AS "playerB",
            c.score::float AS score, c.evidence, c.status,
            ${SIDE_SQL('player_a')} AS a,
            ${SIDE_SQL('player_b')} AS b
       FROM player_link_candidates c
      WHERE c.status = $1
      ORDER BY c.score DESC, c.created_at
      LIMIT $2`,
    [status, limit],
  );
  return r.rows;
}

/** Rechaza un candidato y prohíbe el par de refs principales para que no vuelva. */
export async function rejectPlayerLinkCandidate(id: string): Promise<boolean> {
  return withTransaction(async (c) => {
    const r = await c.query<{ ra: string | null; rb: string | null }>(
      `UPDATE player_link_candidates pc SET status = 'rejected', resolved_at = NOW()
         FROM players a, players b
        WHERE pc.id = $1 AND pc.status = 'pending' AND a.id = pc.player_a AND b.id = pc.player_b
        RETURNING a.source_ref AS ra, b.source_ref AS rb`,
      [id],
    );
    const row = r.rows[0];
    if (!row) return false;
    if (row.ra && row.rb) await forbidPlayerLink(row.ra, row.rb, 'rechazado en revisión', c);
    return true;
  });
}

/** Acepta un candidato: enlaza B en A (A = la ficha más antigua). */
export async function acceptPlayerLinkCandidate(id: string, by: string): Promise<{ keepId: string; absorbedId: string } | null> {
  const r = await db.query<{ player_a: string; player_b: string; a_created: Date; b_created: Date }>(
    `SELECT c.player_a, c.player_b, pa.created_at AS a_created, pb.created_at AS b_created
       FROM player_link_candidates c JOIN players pa ON pa.id = c.player_a JOIN players pb ON pb.id = c.player_b
      WHERE c.id = $1 AND c.status = 'pending'`,
    [id],
  );
  const row = r.rows[0];
  if (!row) return null;
  const [keepId, absorbedId] = row.a_created <= row.b_created ? [row.player_a, row.player_b] : [row.player_b, row.player_a];
  await linkPlayers(keepId, absorbedId, by);
  return { keepId, absorbedId };
}
