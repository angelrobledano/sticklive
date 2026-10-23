import pg from 'pg';
import { withTransaction } from '../client.js';
import { recordEntityRedirect } from './redirects.js';

/**
 * Fusión de dos fichas de equipo que son el mismo equipo (típicamente el mismo
 * equipo dado de alta por dos fuentes: la RFEP y una federación autonómica).
 * Todo lo de `mergeId` pasa a `keepId`, `mergeId` se borra y su URL redirige
 * (308) a `keepId` (entity_redirects, 073).
 *
 * Guardas (lanzan, no fusionan):
 *  · los dos existen y son distintos;
 *  · misma sección (género y categoría) salvo `force`: fusionar la ficha
 *    júnior con la sénior mezclaría plantillas y clasificaciones;
 *  · nunca se han enfrentado: si hay un partido entre los dos, son equipos
 *    distintos (o el dato está mal y hay que mirarlo a mano).
 *
 * Choques de unicidad: si los dos están en la misma temporada (season_teams,
 * team_players, standings, favoritos), se conserva la fila de `keepId`.
 * Las refs de fuente de `mergeId` (source_ref + alt) se añaden a las de
 * `keepId`, así los scrapers de su fuente siguen encontrando el equipo.
 */
export interface MergeTeamsReport {
  keep: { id: string; name: string };
  merge: { id: string; name: string };
  moved: Record<string, number>;
  dropped: Record<string, number>;
}

interface TeamRow {
  id: string; name: string; gender: string | null; age_category: string | null;
  source_ref: string | null; alt_source_refs: string[] | null;
}

export async function mergeTeams(
  keepId: string,
  mergeId: string,
  opts: { force?: boolean; dryRun?: boolean; reason?: string } = {},
): Promise<MergeTeamsReport> {
  if (keepId === mergeId) throw new Error('mergeTeams: keep y merge son el mismo equipo');
  const run = async (c: pg.PoolClient): Promise<MergeTeamsReport> => {
    const { rows } = await c.query<TeamRow>(
      `SELECT id, name, gender, age_category, source_ref, alt_source_refs FROM teams WHERE id = ANY($1) FOR UPDATE`,
      [[keepId, mergeId]],
    );
    const keep = rows.find((r) => r.id === keepId);
    const merge = rows.find((r) => r.id === mergeId);
    if (!keep || !merge) throw new Error(`mergeTeams: no existe ${!keep ? keepId : mergeId}`);
    const section = (t: TeamRow) => `${t.gender ?? '?'}/${t.age_category ?? '?'}`;
    if (!opts.force && (keep.gender ?? null) !== (merge.gender ?? null)) {
      throw new Error(`mergeTeams: secciones distintas (${section(keep)} vs ${section(merge)}). Usa force si de verdad son el mismo equipo.`);
    }
    if (!opts.force && (keep.age_category ?? null) !== (merge.age_category ?? null)) {
      throw new Error(`mergeTeams: secciones distintas (${section(keep)} vs ${section(merge)}). Usa force si de verdad son el mismo equipo.`);
    }
    const vs = await c.query(
      `SELECT 1 FROM matches WHERE (home_team_id = $1 AND away_team_id = $2) OR (home_team_id = $2 AND away_team_id = $1) LIMIT 1`,
      [keepId, mergeId],
    );
    if ((vs.rowCount ?? 0) > 0) throw new Error(`mergeTeams: "${keep.name}" y "${merge.name}" se han enfrentado: no son el mismo equipo`);

    const moved: Record<string, number> = {};
    const dropped: Record<string, number> = {};
    const q = async (bucket: Record<string, number>, key: string, sql: string) => {
      const r = await c.query(sql, [keepId, mergeId]);
      bucket[key] = (bucket[key] ?? 0) + (r.rowCount ?? 0);
    };

    // Inscripciones: en una temporada común se queda la de keep (y hereda la ref si no tenía).
    await c.query(
      `UPDATE season_teams k SET source_ref = COALESCE(k.source_ref, m.source_ref)
         FROM season_teams m
        WHERE k.team_id = $1 AND m.team_id = $2 AND k.season_id = m.season_id`,
      [keepId, mergeId],
    );
    await q(dropped, 'season_teams', `DELETE FROM season_teams m USING season_teams k
       WHERE m.team_id = $2 AND k.team_id = $1 AND k.season_id = m.season_id`);
    await q(moved, 'season_teams', `UPDATE season_teams SET team_id = $1 WHERE team_id = $2`);

    await q(dropped, 'team_players', `DELETE FROM team_players m USING team_players k
       WHERE m.team_id = $2 AND k.team_id = $1 AND k.season_id = m.season_id AND k.player_id = m.player_id`);
    await q(moved, 'team_players', `UPDATE team_players SET team_id = $1 WHERE team_id = $2`);

    await q(dropped, 'standings', `DELETE FROM standings m USING standings k
       WHERE m.team_id = $2 AND k.team_id = $1 AND k.season_id = m.season_id
         AND COALESCE(k.phase_id::text, '') = COALESCE(m.phase_id::text, '')
         AND COALESCE(k.group_name, '') = COALESCE(m.group_name, '')`);
    await q(moved, 'standings', `UPDATE standings SET team_id = $1 WHERE team_id = $2`);

    await q(moved, 'matches_home', `UPDATE matches SET home_team_id = $1, updated_at = NOW() WHERE home_team_id = $2`);
    await q(moved, 'matches_away', `UPDATE matches SET away_team_id = $1, updated_at = NOW() WHERE away_team_id = $2`);
    await q(moved, 'matches_winner', `UPDATE matches SET winner_team_id = $1 WHERE winner_team_id = $2`);
    await q(moved, 'match_lineups', `UPDATE match_lineups SET team_id = $1 WHERE team_id = $2`);
    await q(moved, 'match_events', `UPDATE match_events SET team_id = $1 WHERE team_id = $2`);
    await q(moved, 'source_entity_map', `UPDATE source_entity_map SET team_id = $1 WHERE team_id = $2`);
    await q(moved, 'team_aliases', `UPDATE team_aliases SET team_id = $1 WHERE team_id = $2`);
    await q(moved, 'source_club_map', `UPDATE source_club_map SET team_id = $1 WHERE team_id = $2`);
    await q(moved, 'resolution_queue', `UPDATE resolution_queue SET resolved_team_id = $1 WHERE resolved_team_id = $2`);

    // Favoritos: quien seguía a los dos se queda con uno.
    await q(dropped, 'user_favorites', `DELETE FROM user_favorites m USING user_favorites k
       WHERE m.kind = 'team' AND k.kind = 'team' AND m.ref_id = $2 AND k.ref_id = $1 AND k.user_id = m.user_id`);
    await q(moved, 'user_favorites', `UPDATE user_favorites SET ref_id = $1 WHERE kind = 'team' AND ref_id = $2`);
    await q(moved, 'push_subscriptions', `UPDATE push_subscriptions
         SET fav_teams = ARRAY(SELECT DISTINCT x FROM unnest(array_replace(fav_teams, $2::uuid, $1::uuid)) x)
       WHERE $2::uuid = ANY(fav_teams)`);
    await q(moved, 'push_tokens', `UPDATE push_tokens
         SET fav_teams = (SELECT jsonb_agg(DISTINCT CASE WHEN v = $2::text THEN $1::text ELSE v END)
                            FROM jsonb_array_elements_text(fav_teams) v)
       WHERE jsonb_typeof(fav_teams) = 'array' AND fav_teams ? $2::text`);

    // Refs de fuente: las de merge pasan a keep (los scrapers siguen encontrándolo).
    const refs = [merge.source_ref, ...(merge.alt_source_refs ?? [])].filter((r): r is string => !!r);
    await c.query(
      `UPDATE teams k SET
         alt_source_refs = ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(k.alt_source_refs, '{}') || $2::text[]) x
                                  WHERE x IS DISTINCT FROM k.source_ref),
         logo_url = COALESCE(k.logo_url, m.logo_url),
         club_id  = COALESCE(k.club_id, m.club_id),
         short_name = COALESCE(k.short_name, m.short_name),
         updated_at = NOW()
        FROM teams m WHERE k.id = $1 AND m.id = $3`,
      [keepId, refs, mergeId],
    );

    await c.query(`DELETE FROM teams WHERE id = $1`, [mergeId]);
    await recordEntityRedirect('team', mergeId, keepId, opts.reason ?? `fusión con ${keep.name}`, c);

    const report = { keep: { id: keep.id, name: keep.name }, merge: { id: merge.id, name: merge.name }, moved, dropped };
    if (opts.dryRun) throw Object.assign(new Error('dry-run'), { report });
    return report;
  };

  try {
    return await withTransaction(run);
  } catch (err) {
    const report = (err as { report?: MergeTeamsReport }).report;
    if (opts.dryRun && report) return report;
    throw err;
  }
}

