import pg from 'pg';
import { db } from '../client.js';

export interface DbTeam {
  id: string;
  sport_id: string;
  name: string;
  short_name: string | null;
  slug: string;
  city: string | null;
  country: string;
  logo_url: string | null;
  website_url: string | null;
  source_id: string | null;
  source_ref: string | null;
  source_url: string | null;
  alt_source_refs: string[];
  // Columnas añadidas por migraciones posteriores al tipo original (032:
  // team_type/gender/age_category; 044: club_id/squad_level). Opcionales para no
  // romper construcciones existentes; con `SELECT *` llegan siempre.
  team_type?: string | null;
  gender?: string | null;
  age_category?: string | null;
  club_id?: string | null;
  squad_level?: number | null;
  scraped_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// `upsertTeam`, su interfaz `UpsertTeamInput` y `findTeamByNameSimilarity` se
// eliminaron (#199): eran código muerto sin consumidores — el alta de equipos
// vive en el seed de competición y el fuzzy disciplinado en entity-resolution
// (autoConfirmTeam + cola HITL). El viejo umbral 0.4 de
// findTeamByNameSimilarity fue, además, el origen del falso positivo del Liceo
// (#322).

export async function findTeamById(teamId: string): Promise<DbTeam | null> {
  const result = await db.query<DbTeam>('SELECT * FROM teams WHERE id = $1', [teamId]);
  return result.rows[0] ?? null;
}

export async function findTeamBySourceRef(sourceRef: string): Promise<DbTeam | null> {
  // Busca tanto en source_ref principal como en el array alt_source_refs.
  // Esto permite que scrapers con sistemas de IDs distintos (ej: rfep_mc_1.php
  // usa club_44 mientras el calendario usa 3373) resuelvan al mismo equipo.
  const result = await db.query<DbTeam>(
    'SELECT * FROM teams WHERE source_ref = $1 OR $1 = ANY(alt_source_refs)',
    [sourceRef]
  );
  return result.rows[0] ?? null;
}

/**
 * TODOS los equipos cuyo source_ref (o alt) casa con `sourceRef` (#228).
 *
 * El puente `source_ref`/`alt_source_refs` es GLOBAL (sin namespacing por
 * portal), así que la misma ref puede casar con 2-3 equipos. `findTeamBySourceRef`
 * devuelve el primero a ciegas; esta variante permite al consumidor decidir (p.
 * ej. NO resolver si es ambigua). Orden estable por `created_at` para que el
 * resultado sea determinista.
 */
export async function findTeamsBySourceRef(sourceRef: string): Promise<DbTeam[]> {
  const result = await db.query<DbTeam>(
    'SELECT * FROM teams WHERE source_ref = $1 OR $1 = ANY(alt_source_refs) ORDER BY created_at, id',
    [sourceRef]
  );
  return result.rows;
}

/**
 * Añade un ref alternativo al array alt_source_refs de un equipo.
 * Idempotente: no duplica si el ref ya existe.
 */
export async function addTeamAltRef(
  teamId: string,
  altRef: string,
  client: pg.PoolClient | typeof db = db
): Promise<void> {
  await client.query(
    `UPDATE teams
     SET alt_source_refs = array_append(alt_source_refs, $2),
         updated_at = NOW()
     WHERE id = $1
       AND NOT ($2 = ANY(alt_source_refs))`,
    [teamId, altRef]
  );
}

export async function findTeamBySlug(sportId: string, slug: string): Promise<DbTeam | null> {  const result = await db.query<DbTeam>(
    'SELECT * FROM teams WHERE sport_id = $1 AND slug = $2',
    [sportId, slug]
  );
  return result.rows[0] ?? null;
}

/** Actualiza el logo_url de un equipo existente por UUID. */
export async function updateTeamLogoUrl(
  teamId: string,
  logoUrl: string,
  client: pg.PoolClient | typeof db = db
): Promise<void> {
  await client.query(
    `UPDATE teams SET logo_url = $2, updated_at = NOW() WHERE id = $1`,
    [teamId, logoUrl]
  );
}

// findTeamByNameSimilarity eliminada (#199): ver nota arriba.

/**
 * Equipo de ESTA temporada cuyo nombre coincide con el de la fuente.
 *
 * Las clasificaciones traen solo el NOMBRE (sin ref), así que resolverlas contra
 * toda la tabla reencuentra al primer equipo cuando un filial se llama igual
 * (caso NOIA A/B). Mirando SOLO los equipos de la temporada, el primer equipo no
 * está (juega en otra liga) y el filial sí: primero coincidencia exacta y, si no,
 * con el sufijo " B" que añade la reparación de filiales.
 */
export async function findTeamInSeasonByName(
  seasonId: string,
  name: string,
  abbreviation?: string | null,
  client: pg.PoolClient | typeof db = db,
): Promise<string | null> {
  // La fuente cambia el nombre por patrocinios ("FENIE ENERGIA CERDANYOLA CCH")
  // mientras la ficha conserva el canónico. La abreviatura de la tabla (CCH) es
  // más estable. Se usa SOLO si no hay match por nombre y NO es ambigua dentro
  // de la temporada (p. ej. "CHM" lo comparten Mataró y Mollerussa).
  const result = await client.query<{ id: string }>(
    `WITH candidatos AS (
       SELECT t.id,
              (lower(t.name) = lower($2)) AS nombre_exacto,
              (lower(t.name) LIKE lower($2) || ' b%') AS nombre_filial,
              (translate(lower(t.name), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')
                 = translate(lower($2), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc')) AS nombre_sin_acentos,
              ($3 <> '' AND lower(t.short_name) = lower($3)) AS abreviatura,
              COUNT(*) FILTER (WHERE $3 <> '' AND lower(t.short_name) = lower($3))
                OVER () AS abreviaturas
         FROM season_teams st JOIN teams t ON t.id = st.team_id
        WHERE st.season_id = $1
     )
     SELECT id FROM candidatos
      WHERE nombre_exacto OR nombre_filial OR nombre_sin_acentos OR (abreviatura AND abreviaturas = 1)
      ORDER BY nombre_exacto DESC, nombre_filial DESC, nombre_sin_acentos DESC
      LIMIT 1`,
    [seasonId, name, abbreviation ?? ''],
  );
  return result.rows[0]?.id ?? null;
}
