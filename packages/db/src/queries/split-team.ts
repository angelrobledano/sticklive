import pg from 'pg';
import { withTransaction } from '../client.js';

/**
 * Separación de un equipo que mezcla secciones (típicamente fichas del archivo
 * histórico que recibieron partidos masculinos y femeninos, o el primer equipo
 * y sus filiales). Es la operación inversa a `mergeTeams`.
 *
 * Cada ruta lleva un conjunto de temporadas (= competición + temporada) a un
 * equipo destino: uno existente (`teamId`) o uno nuevo del mismo club con su
 * sección. Lo que no se enruta se queda en el equipo original. Por cada
 * temporada enrutada se mueven partidos (local, visitante, ganador), las
 * alineaciones y eventos del equipo en esos partidos, la inscripción, la
 * clasificación y la plantilla.
 *
 * Guardas (lanzan, no tocan nada): el destino existe y es distinto del
 * origen; las temporadas no se repiten entre rutas; ningún partido movido es
 * entre el origen y el destino (quedaría un equipo contra sí mismo).
 */
export type SplitTarget =
  | { teamId: string }
  | { name: string; gender: 'male' | 'female' | 'mixed' | null; ageCategory: string | null; squadLevel?: number };

export interface SplitRoute { seasonIds: string[]; target: SplitTarget }

export interface SplitTeamReport {
  source: { id: string; name: string };
  routes: Array<{ teamId: string; name: string; created: boolean; seasons: number; matches: number; moved: Record<string, number> }>;
}

export class SplitTeamError extends Error {
  constructor(message: string) { super(message); this.name = 'SplitTeamError'; }
}

const slugPart = (text: string): string => text
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);

async function freeSlug(c: pg.PoolClient, sportId: string, name: string, gender: string | null, age: string | null): Promise<string> {
  const base = slugPart(name) || 'equipo';
  const options = [base, age && age !== 'senior' ? `${base}-${age}` : null, gender ? `${base}-${gender === 'female' ? 'f' : 'm'}` : null]
    .filter((x): x is string => !!x);
  for (const s of options) {
    if (!(await c.query(`SELECT 1 FROM teams WHERE sport_id = $1 AND slug = $2`, [sportId, s])).rowCount) return s;
  }
  for (let n = 2; ; n++) {
    const s = `${options[options.length - 1]}-${n}`;
    if (!(await c.query(`SELECT 1 FROM teams WHERE sport_id = $1 AND slug = $2`, [sportId, s])).rowCount) return s;
  }
}

export async function splitTeam(
  sourceId: string,
  routes: SplitRoute[],
  opts: { dryRun?: boolean } = {},
): Promise<SplitTeamReport> {
  if (routes.length === 0) throw new SplitTeamError('Hace falta al menos una ruta');
  const all = routes.flatMap((r) => r.seasonIds);
  if (all.length === 0) throw new SplitTeamError('Cada ruta necesita al menos una temporada');
  if (new Set(all).size !== all.length) throw new SplitTeamError('Una temporada aparece en dos rutas');

  const run = async (c: pg.PoolClient): Promise<SplitTeamReport> => {
    const src = (await c.query<{ id: string; name: string; sport_id: string; club_id: string | null; country: string; source_id: string | null }>(
      `SELECT id, name, sport_id, club_id, country, source_id FROM teams WHERE id = $1 FOR UPDATE`, [sourceId])).rows[0];
    if (!src) throw new SplitTeamError('No existe el equipo a separar');

    const report: SplitTeamReport = { source: { id: src.id, name: src.name }, routes: [] };
    for (const route of routes) {
      let targetId: string;
      let targetName: string;
      let created = false;
      if ('teamId' in route.target) {
        if (route.target.teamId === sourceId) throw new SplitTeamError('El destino no puede ser el propio equipo');
        const t = (await c.query<{ id: string; name: string; sport_id: string }>(
          `SELECT id, name, sport_id FROM teams WHERE id = $1 FOR UPDATE`, [route.target.teamId])).rows[0];
        if (!t) throw new SplitTeamError('No existe el equipo destino');
        if (t.sport_id !== src.sport_id) throw new SplitTeamError('El destino es de otro deporte');
        targetId = t.id; targetName = t.name;
      } else {
        const { name, gender, ageCategory } = route.target;
        const squadLevel = route.target.squadLevel ?? 1;
        if (!name.trim()) throw new SplitTeamError('El equipo nuevo necesita nombre');
        const slug = await freeSlug(c, src.sport_id, name, gender, ageCategory);
        targetId = (await c.query<{ id: string }>(
          `INSERT INTO teams (sport_id, name, slug, gender, age_category, squad_level, country, club_id, source_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [src.sport_id, name.trim(), slug, gender, ageCategory, squadLevel, src.country, src.club_id, src.source_id],
        )).rows[0]!.id;
        targetName = name.trim(); created = true;
      }

      const seasons = route.seasonIds;
      const matchIds = (await c.query<{ id: string; vs_target: boolean }>(
        `SELECT id, (home_team_id = $3 OR away_team_id = $3) AS vs_target FROM matches
          WHERE season_id = ANY($2::uuid[]) AND (home_team_id = $1 OR away_team_id = $1)`,
        [sourceId, seasons, targetId],
      )).rows;
      if (matchIds.some((m) => m.vs_target)) {
        throw new SplitTeamError(`"${src.name}" se enfrenta a "${targetName}" en esas temporadas: no pueden ser el mismo equipo`);
      }
      const ids = matchIds.map((m) => m.id);
      const moved: Record<string, number> = {};
      const q = async (key: string, sql: string, args: unknown[]) => {
        moved[key] = (moved[key] ?? 0) + ((await c.query(sql, args)).rowCount ?? 0);
      };
      await q('match_lineups', `UPDATE match_lineups SET team_id = $2 WHERE team_id = $1 AND match_id = ANY($3::uuid[])`, [sourceId, targetId, ids]);
      await q('match_events', `UPDATE match_events SET team_id = $2 WHERE team_id = $1 AND match_id = ANY($3::uuid[])`, [sourceId, targetId, ids]);
      await q('matches_home', `UPDATE matches SET home_team_id = $2, updated_at = NOW() WHERE home_team_id = $1 AND id = ANY($3::uuid[])`, [sourceId, targetId, ids]);
      await q('matches_away', `UPDATE matches SET away_team_id = $2, updated_at = NOW() WHERE away_team_id = $1 AND id = ANY($3::uuid[])`, [sourceId, targetId, ids]);
      await q('matches_winner', `UPDATE matches SET winner_team_id = $2 WHERE winner_team_id = $1 AND id = ANY($3::uuid[])`, [sourceId, targetId, ids]);
      // Inscripción, clasificación y plantilla: si el destino ya tiene la suya en esa temporada, manda la del destino.
      await q('season_teams_dropped', `DELETE FROM season_teams s USING season_teams k
        WHERE s.team_id = $1 AND k.team_id = $2 AND k.season_id = s.season_id AND s.season_id = ANY($3::uuid[])`, [sourceId, targetId, seasons]);
      await q('season_teams', `UPDATE season_teams SET team_id = $2 WHERE team_id = $1 AND season_id = ANY($3::uuid[])`, [sourceId, targetId, seasons]);
      await q('standings_dropped', `DELETE FROM standings s USING standings k
        WHERE s.team_id = $1 AND k.team_id = $2 AND k.season_id = s.season_id AND s.season_id = ANY($3::uuid[])
          AND COALESCE(k.phase_id::text, '') = COALESCE(s.phase_id::text, '') AND COALESCE(k.group_name, '') = COALESCE(s.group_name, '')`,
        [sourceId, targetId, seasons]);
      await q('standings', `UPDATE standings SET team_id = $2 WHERE team_id = $1 AND season_id = ANY($3::uuid[])`, [sourceId, targetId, seasons]);
      await q('team_players_dropped', `DELETE FROM team_players s USING team_players k
        WHERE s.team_id = $1 AND k.team_id = $2 AND k.season_id = s.season_id AND k.player_id = s.player_id AND s.season_id = ANY($3::uuid[])`,
        [sourceId, targetId, seasons]);
      await q('team_players', `UPDATE team_players SET team_id = $2 WHERE team_id = $1 AND season_id = ANY($3::uuid[])`, [sourceId, targetId, seasons]);

      report.routes.push({ teamId: targetId, name: targetName, created, seasons: seasons.length, matches: ids.length, moved });
    }
    if (opts.dryRun) throw Object.assign(new Error('dry-run'), { report });
    return report;
  };

  try {
    return await withTransaction(run);
  } catch (err) {
    const report = (err as { report?: SplitTeamReport }).report;
    if (opts.dryRun && report) return report;
    throw err;
  }
}
