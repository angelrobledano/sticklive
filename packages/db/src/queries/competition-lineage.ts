/**
 * B4 — Linaje de competición: colgar como FASE (o grupo) de otra competición
 * un idc que la fuente publica aparte.
 *
 * Sidgad da idc propio al play-off ("OK LIGA PLATA MASCULINA ELIMINATORIA") y
 * a los grupos territoriales ("OK LIGA PLATA NORTE"/"SUR"). Cargados por
 * separado son competiciones distintas en la web. Para OK Liga se arregló con
 * migraciones a mano (014, 026); esto lo hace genérico y deja el idc declarado
 * en `competition_sources.external_ids.playoff_idcs` de la madre, para que el
 * pipeline lo siga cargando ya dentro de su temporada.
 *
 * Empareja temporadas por NOMBRE ("2025/26"). Si una temporada de la hija no
 * tiene pareja, no hace nada y falla: nada de fusiones parciales.
 */
import { db, withTransaction } from '../client.js';
import { recordEntityRedirect } from './redirects.js';

export interface AttachPhaseOptions {
  childId: string;
  parentId: string;
  /** Tipo de la fase resultante: 'knockout' (play-off) o 'groups' (grupo territorial). */
  kind: 'knockout' | 'groups' | 'league';
  /** Para grupos territoriales: etiqueta de grupo ("Norte", "Sur"). */
  groupName?: string;
  write: boolean;
}

export interface AttachPhasePlan {
  seasons: { childSeasonId: string; parentSeasonId: string; name: string; matches: number }[];
}

export async function attachCompetitionAsPhase(opts: AttachPhaseOptions): Promise<AttachPhasePlan> {
  const pairs = await db.query<{ child_id: string; parent_id: string | null; name: string; matches: number }>(
    `SELECT cs.id AS child_id, ps.id AS parent_id, cs.name,
            (SELECT count(*)::int FROM matches m WHERE m.season_id = cs.id) AS matches
       FROM seasons cs
       LEFT JOIN seasons ps ON ps.competition_id = $2 AND ps.name = cs.name
      WHERE cs.competition_id = $1
      ORDER BY cs.name`,
    [opts.childId, opts.parentId],
  );
  const huerfanas = pairs.rows.filter((p) => !p.parent_id).map((p) => p.name);
  if (huerfanas.length > 0) {
    throw new Error(`attachCompetitionAsPhase: temporadas sin pareja en la madre: ${huerfanas.join(', ')}`);
  }
  const plan: AttachPhasePlan = {
    seasons: pairs.rows.map((p) => ({ childSeasonId: p.child_id, parentSeasonId: p.parent_id!, name: p.name, matches: p.matches })),
  };
  if (!opts.write) return plan;

  const child = (await db.query<{ name: string }>(`SELECT name FROM competitions WHERE id = $1`, [opts.childId])).rows[0];
  if (!child) throw new Error('attachCompetitionAsPhase: la competición hija no existe');
  const group = opts.groupName ?? null;

  await withTransaction(async (c) => {
    for (const s of plan.seasons) {
      const from = s.childSeasonId;
      const to = s.parentSeasonId;
      const maxOrd = (await c.query<{ m: number }>(
        `SELECT COALESCE(max(ordinal), 0)::int AS m FROM phases WHERE season_id = $1`, [to],
      )).rows[0]!.m;

      // Las fases que ya tenía la hija se trasladan detrás de las de la madre.
      await c.query(`UPDATE phases SET season_id = $2, ordinal = ordinal + $3 WHERE season_id = $1`, [from, to, maxOrd]);

      // Lo que no tenía fase cuelga de una fase nueva con el nombre de la hija.
      const sinFase = await c.query(
        `SELECT 1 FROM rounds WHERE season_id = $1 AND phase_id IS NULL
         UNION ALL SELECT 1 FROM matches WHERE season_id = $1 AND phase_id IS NULL LIMIT 1`, [from],
      );
      if (sinFase.rowCount) {
        const nextOrd = (await c.query<{ m: number }>(
          `SELECT COALESCE(max(ordinal), 0)::int + 1 AS m FROM phases WHERE season_id = $1`, [to],
        )).rows[0]!.m;
        const phaseId = (await c.query<{ id: string }>(
          `INSERT INTO phases (season_id, kind, is_placement, ordinal, name, resolved_by, source_ref)
           VALUES ($1, $2, FALSE, $3, $4, 'declared', $5) RETURNING id`,
          [to, opts.kind, nextOrd, child.name, `lineage_${from}`],
        )).rows[0]!.id;
        await c.query(`UPDATE rounds SET phase_id = $2 WHERE season_id = $1 AND phase_id IS NULL`, [from, phaseId]);
        await c.query(`UPDATE matches SET phase_id = $2 WHERE season_id = $1 AND phase_id IS NULL`, [from, phaseId]);
        await c.query(`UPDATE standings SET phase_id = $2 WHERE season_id = $1 AND phase_id IS NULL`, [from, phaseId]);
      }

      await c.query(`UPDATE rounds SET season_id = $2 WHERE season_id = $1`, [from, to]);
      await c.query(
        `UPDATE matches SET season_id = $2, group_name = COALESCE($3, group_name), updated_at = NOW() WHERE season_id = $1`,
        [from, to, group],
      );
      await c.query(
        `UPDATE standings SET season_id = $2, group_name = COALESCE($3, group_name), updated_at = NOW() WHERE season_id = $1`,
        [from, to, group],
      );
      await c.query(
        `INSERT INTO season_teams (season_id, team_id, group_name, source_ref)
         SELECT $2, team_id, COALESCE($3, group_name), source_ref FROM season_teams WHERE season_id = $1
         ON CONFLICT DO NOTHING`,
        [from, to, group],
      );
      await c.query(`DELETE FROM season_teams WHERE season_id = $1`, [from]);
      await c.query(
        `INSERT INTO team_players (season_id, team_id, player_id, jersey_number, is_active)
         SELECT $2, team_id, player_id, jersey_number, is_active FROM team_players WHERE season_id = $1
         ON CONFLICT (season_id, team_id, player_id) DO NOTHING`,
        [from, to],
      );
      await c.query(`DELETE FROM team_players WHERE season_id = $1`, [from]);
      await c.query(`DELETE FROM standings_zones WHERE season_id = $1`, [from]);
      await c.query(`DELETE FROM seasons WHERE id = $1`, [from]);
    }

    // El idc de la hija pasa a ser un idc secundario de la madre.
    await c.query(
      `UPDATE competition_sources p
          SET external_ids = jsonb_set(p.external_ids, '{playoff_idcs}',
                (COALESCE(p.external_ids->'playoff_idcs', '[]'::jsonb) || jsonb_build_array(h.external_ids->>'idc'))),
              updated_at = NOW()
         FROM competition_sources h
        WHERE p.competition_id = $1 AND h.competition_id = $2 AND h.external_ids ? 'idc'
          AND NOT (COALESCE(p.external_ids->'playoff_idcs', '[]'::jsonb) ? (h.external_ids->>'idc'))`,
      [opts.parentId, opts.childId],
    );
    await c.query(
      `DELETE FROM user_favorites a USING user_favorites k
        WHERE a.kind = 'league' AND k.kind = 'league' AND a.ref_id = $2 AND k.ref_id = $1 AND a.user_id = k.user_id`,
      [opts.parentId, opts.childId],
    );
    await c.query(`UPDATE user_favorites SET ref_id = $1 WHERE kind = 'league' AND ref_id = $2`, [opts.parentId, opts.childId]);
    await c.query(`DELETE FROM competitions WHERE id = $1`, [opts.childId]);
    await recordEntityRedirect('competition', opts.childId, opts.parentId, 'lineage:phase', c);
  });
  return plan;
}
