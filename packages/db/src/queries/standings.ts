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
  /** Fase a la que pertenece la tabla (A7). Sin fase = clasificación de temporada. */
  phaseId?: string | null;
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
 * Clave: (season_id, team_id, phase_id, group_name) — phase_id NULL equivale a antes (A7).
 */
export async function upsertStanding(
  input: UpsertStandingInput,
  client: pg.PoolClient | typeof db = db
): Promise<DbStanding> {
  // Transición (A7): la primera escritura con fase ADOPTA la fila legada sin
  // fase del mismo equipo y grupo, en vez de dejarla al lado como duplicado.
  if (input.phaseId) {
    await client.query(
      `UPDATE standings s SET phase_id = $3
        WHERE s.season_id = $1 AND s.team_id = $2 AND s.phase_id IS NULL
          AND COALESCE(s.group_name, '') = COALESCE($4, '')
          AND NOT EXISTS (SELECT 1 FROM standings x
                           WHERE x.season_id = $1 AND x.team_id = $2 AND x.phase_id = $3
                             AND COALESCE(x.group_name, '') = COALESCE($4, ''))`,
      [input.seasonId, input.teamId, input.phaseId, input.groupName ?? null],
    );
  }
  const result = await client.query<DbStanding>(
    `INSERT INTO standings
       (season_id, team_id, group_name, position,
        played, won, drawn, lost, goals_for, goals_against, points, form,
        source_id, scraped_at, phase_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (season_id, team_id, COALESCE(phase_id::text, ''), COALESCE(group_name, '')) DO UPDATE SET
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
      input.phaseId ?? null,
    ]
  );
  return result.rows[0]!;
}

export async function getStandings(
  seasonId: string,
  groupName?: string,
  phaseId?: string,
): Promise<DbStanding[]> {
  // A7: con varias fases con tabla, sin `phaseId` se sirve la ÚLTIMA (mayor
  // ordinal), que es lo que se veía antes cuando la segunda pisaba a la primera.
  const phaseFilter = phaseId
    ? `AND st.phase_id = $PHASE`
    : `AND st.phase_id IS NOT DISTINCT FROM (
         SELECT s2.phase_id FROM standings s2 LEFT JOIN phases p ON p.id = s2.phase_id
          WHERE s2.season_id = st.season_id
          ORDER BY p.ordinal DESC NULLS LAST LIMIT 1)`;
  // Incluye datos del equipo (nombre, abreviatura, logo): los consumidores
  // del endpoint no necesitan así un segundo fetch.
  if (groupName) {
    const result = await db.query<DbStanding>(
      `SELECT st.*, COALESCE(t.display_name, t.name) AS team_name, t.short_name AS team_short_name, t.logo_url AS team_logo_url
       FROM standings st
       JOIN teams t ON t.id = st.team_id
       WHERE st.season_id = $1 AND st.group_name = $2 ${phaseFilter.replace('$PHASE', '$3')}
       ORDER BY st.position NULLS LAST, st.points DESC, st.goal_diff DESC`,
      phaseId ? [seasonId, groupName, phaseId] : [seasonId, groupName]
    );
    return result.rows;
  }
  const result = await db.query<DbStanding>(
    `SELECT st.*, COALESCE(t.display_name, t.name) AS team_name, t.short_name AS team_short_name, t.logo_url AS team_logo_url
     FROM standings st
     JOIN teams t ON t.id = st.team_id
     WHERE st.season_id = $1 ${phaseFilter.replace('$PHASE', '$2')}
     ORDER BY st.group_name NULLS FIRST, st.position NULLS LAST, st.points DESC`,
    phaseId ? [seasonId, phaseId] : [seasonId]
  );
  return result.rows;
}
