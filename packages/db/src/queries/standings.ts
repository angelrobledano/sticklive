import pg from 'pg';
import { db } from '../client.js';

export interface DbStanding {
  id: string;
  season_id: string;
  team_id: string;
  group_name: string | null;
  position: number | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;  // columna generada
  points: number;
  form: string[] | null;
  source_id: string | null;
  scraped_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertStandingInput {
  seasonId: string;
  teamId: string;
  groupName?: string;
  position?: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form?: string[];
  sourceId?: string;
  scrapedAt?: Date;
}

/**
 * Upsert de clasificación.
 * La clasificación es una foto completa — siempre sobreescribir con los últimos datos.
 * Clave: (season_id, team_id, group_name).
 */
export async function upsertStanding(
  input: UpsertStandingInput,
  client: pg.PoolClient | typeof db = db
): Promise<DbStanding> {
  const result = await client.query<DbStanding>(
    `INSERT INTO standings
       (season_id, team_id, group_name, position,
        played, won, drawn, lost, goals_for, goals_against, points, form,
        source_id, scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (season_id, team_id, COALESCE(group_name, '')) DO UPDATE SET
       position       = EXCLUDED.position,
       played         = EXCLUDED.played,
       won            = EXCLUDED.won,
       drawn          = EXCLUDED.drawn,
       lost           = EXCLUDED.lost,
       goals_for      = EXCLUDED.goals_for,
       goals_against  = EXCLUDED.goals_against,
       points         = EXCLUDED.points,
       form           = EXCLUDED.form,
       scraped_at     = EXCLUDED.scraped_at,
       updated_at     = NOW()
     RETURNING *`,
    [
      input.seasonId,
      input.teamId,
      input.groupName ?? null,
      input.position ?? null,
      input.played,
      input.won,
      input.drawn,
      input.lost,
      input.goalsFor,
      input.goalsAgainst,
      input.points,
      input.form ?? null,
      input.sourceId ?? null,
      input.scrapedAt ?? null,
    ]
  );
  return result.rows[0]!;
}

export async function getStandings(
  seasonId: string,
  groupName?: string
): Promise<DbStanding[]> {
  // Incluye datos del equipo (nombre, abreviatura, logo): los consumidores
  // del endpoint no necesitan así un segundo fetch.
  if (groupName) {
    const result = await db.query<DbStanding>(
      `SELECT st.*, COALESCE(t.display_name, t.name) AS team_name, t.short_name AS team_short_name, t.logo_url AS team_logo_url
       FROM standings st
       JOIN teams t ON t.id = st.team_id
       WHERE st.season_id = $1 AND st.group_name = $2
       ORDER BY st.position NULLS LAST, st.points DESC, st.goal_diff DESC`,
      [seasonId, groupName]
    );
    return result.rows;
  }
  const result = await db.query<DbStanding>(
    `SELECT st.*, COALESCE(t.display_name, t.name) AS team_name, t.short_name AS team_short_name, t.logo_url AS team_logo_url
     FROM standings st
     JOIN teams t ON t.id = st.team_id
     WHERE st.season_id = $1
     ORDER BY st.group_name NULLS FIRST, st.position NULLS LAST, st.points DESC`,
    [seasonId]
  );
  return result.rows;
}
