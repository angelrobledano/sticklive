import { Hono } from 'hono';
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import { captureRouteError } from '../lib/route-error.js';

export const searchRouter = new Hono();

/** Longitud mínima del término: evita scans por una sola letra. */
export const MIN_SEARCH_LENGTH = 2;

/** Longitud máxima del término: acota el trabajo de `strpos` ante entradas raras. */
export const MAX_SEARCH_LENGTH = 80;

/** Máximo de resultados por grupo (equipos / jugadores / competiciones). */
export const SEARCH_LIMIT = 8;

/**
 * Normalización de la aguja: recorta, colapsa espacios, minúsculas y quita
 * diacríticos (NFD). Espejo del `norm()` de la web para que el término enviado
 * case con las columnas normalizadas en SQL (`unaccentExpr`).
 */
export function normalizeSearchTerm(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Parsea `?q=`. Devuelve null si no hay término útil (menos de 2 caracteres). */
export function parseSearchQuery(raw: string | undefined | null): string | null {
  const q = normalizeSearchTerm(raw ?? '').slice(0, MAX_SEARCH_LENGTH);
  return q.length >= MIN_SEARCH_LENGTH ? q : null;
}

/**
 * Vocales/letras acentuadas más frecuentes (ES/PT/FR/IT) → equivalentes ASCII.
 * `translate` exige que ambas cadenas tengan el MISMO número de caracteres.
 */
export const ACCENTS_FROM = 'áàäâãéèëêíìïîóòöôõúùüûñç';
export const ACCENTS_TO = 'aaaaaeeeeiiiiooooouuuunc';

/** Expresión SQL que deja una columna sin mayúsculas ni acentos. */
export function unaccentExpr(column: string): string {
  return `translate(lower(${column}), '${ACCENTS_FROM}', '${ACCENTS_TO}')`;
}

// ── Filas crudas de la BD (snake_case) ──────────────────────────────────────

export interface SearchTeamRow {
  id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  country: string | null;
  // Para distinguir las secciones de un club (30/10/2026): «CD Claret» ×5.
  club_id?: string | null;
  club_slug?: string | null;
  gender?: string | null;
  age_category?: string | null;
  squad_level?: number | null;
  competition_name?: string | null;
}

export interface SearchClubRow {
  id: string;
  slug: string;
  canonical_name: string;
  city: string | null;
  crest_url: string | null;
  team_count: string | number;
}

export interface SearchPlayerRow {
  id: string;
  first_name: string;
  last_name: string;
  photo_url: string | null;
  team_name: string | null;
}

export interface SearchCompetitionRow {
  id: string;
  slug?: string | null;
  name: string;
  name_i18n: Record<string, string> | null;
  short_name: string | null;
  country: string | null;
  scope: string | null;
  season_name: string | null;
}

export interface SearchResults {
  query: string;
  total: number;
  teams: Array<{
    id: string; name: string; shortName: string | null; logoUrl: string | null; country: string | null;
    clubId: string | null; clubSlug: string | null;
    gender: string | null; ageCategory: string | null; squadLevel: number | null; competitionName: string | null;
  }>;
  /** Clubes (un club agrupa sus secciones: la web no repite sus equipos). */
  clubs: Array<{ id: string; slug: string; name: string; city: string | null; crestUrl: string | null; teamCount: number }>;
  players: Array<{ id: string; firstName: string; lastName: string; photoUrl: string | null; teamName: string | null }>;
  competitions: Array<{
    id: string;
    slug: string | null;
    name: string;
    nameI18n: Record<string, string> | null;
    shortName: string | null;
    country: string | null;
    scope: string | null;
    seasonName: string | null;
  }>;
}

/** Agrupa y mapea las filas crudas de los tres grupos al DTO de la API. */
export function buildSearchResults(
  query: string,
  teamRows: SearchTeamRow[],
  playerRows: SearchPlayerRow[],
  competitionRows: SearchCompetitionRow[],
  clubRows: SearchClubRow[] = [],
): SearchResults {
  return {
    query,
    total: clubRows.length + teamRows.length + playerRows.length + competitionRows.length,
    clubs: clubRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.canonical_name,
      city: r.city,
      crestUrl: r.crest_url,
      teamCount: Number(r.team_count ?? 0),
    })),
    teams: teamRows.map((r) => ({
      id: r.id,
      name: r.name,
      shortName: r.short_name,
      logoUrl: r.logo_url,
      country: r.country,
      clubId: r.club_id ?? null,
      clubSlug: r.club_slug ?? null,
      gender: r.gender ?? null,
      ageCategory: r.age_category ?? null,
      squadLevel: r.squad_level ?? null,
      competitionName: r.competition_name ?? null,
    })),
    players: playerRows.map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      photoUrl: r.photo_url,
      teamName: r.team_name,
    })),
    competitions: competitionRows.map((r) => ({
      id: r.id,
      slug: r.slug ?? null,
      name: r.name,
      nameI18n: r.name_i18n,
      shortName: r.short_name,
      country: r.country,
      scope: r.scope,
      seasonName: r.season_name,
    })),
  };
}

// ── Consultas ───────────────────────────────────────────────────────────────
// `$1` = término normalizado (sin acentos, minúsculas); `$2` = límite.
// El ranking: coincidencia exacta > prefijo > resto; desempate alfabético.

/** Nombre de presentación: el curado manda; si no, el de la fuente. */
const TEAM_DISPLAY_NAME = 'COALESCE(t.display_name, t.name)';

export const TEAM_QUERY = `
  SELECT t.id, ${TEAM_DISPLAY_NAME} AS name, t.short_name, t.logo_url, t.country,
         t.club_id, cl.slug AS club_slug, t.gender, t.age_category, t.squad_level,
         cur.competition_name
  FROM teams t
  LEFT JOIN clubs cl ON cl.id = t.club_id
  -- Competición actual: misma regla que la ficha de club (temporada en curso primero).
  LEFT JOIN LATERAL (
    SELECT c.name AS competition_name
      FROM matches m
      JOIN seasons se     ON se.id = m.season_id
      JOIN competitions c ON c.id = se.competition_id
     WHERE (m.home_team_id = t.id OR m.away_team_id = t.id)
       AND se.data_quality = 'ok' AND c.data_quality = 'ok'
     ORDER BY se.is_current DESC, se.start_date DESC NULLS LAST
     LIMIT 1
  ) cur ON TRUE
  WHERE strpos(${unaccentExpr(TEAM_DISPLAY_NAME)}, $1) > 0
     OR strpos(${unaccentExpr("coalesce(t.short_name, '')")}, $1) > 0
  ORDER BY
    (${unaccentExpr(TEAM_DISPLAY_NAME)} = $1) DESC,
    (strpos(${unaccentExpr(TEAM_DISPLAY_NAME)}, $1) = 1) DESC,
    ${TEAM_DISPLAY_NAME} ASC
  LIMIT $2
`;

/**
 * Clubes por su nombre canónico o por el de cualquiera de sus equipos («Claret»
 * encuentra «Hoquei Claret» aunque el club se llame distinto). `team_count` =
 * secciones del club (equipos de club, no selecciones).
 */
export const CLUB_QUERY = `
  SELECT cl.id, cl.slug, cl.canonical_name, cl.city, cl.crest_url,
         -- Mismo criterio que la ficha de club: equipos de la temporada en
         -- curso; si el club no juega esta temporada, los que tengan partidos.
         COALESCE(NULLIF((
           SELECT count(DISTINCT t2.id) FROM teams t2
             JOIN matches m  ON m.home_team_id = t2.id OR m.away_team_id = t2.id
             JOIN seasons se ON se.id = m.season_id AND se.is_current AND se.data_quality = 'ok'
            WHERE t2.club_id = cl.id AND t2.team_type = 'club'), 0), (
           SELECT count(DISTINCT t2.id) FROM teams t2
             JOIN matches m ON m.home_team_id = t2.id OR m.away_team_id = t2.id
            WHERE t2.club_id = cl.id AND t2.team_type = 'club')) AS team_count
  FROM clubs cl
  WHERE strpos(${unaccentExpr('cl.canonical_name')}, $1) > 0
     OR EXISTS (
       SELECT 1 FROM teams t
        WHERE t.club_id = cl.id
          AND strpos(${unaccentExpr(TEAM_DISPLAY_NAME)}, $1) > 0
     )
  ORDER BY
    (${unaccentExpr('cl.canonical_name')} = $1) DESC,
    (strpos(${unaccentExpr('cl.canonical_name')}, $1) = 1) DESC,
    cl.canonical_name ASC
  LIMIT $2
`;

export const PLAYER_QUERY = `
  SELECT
    p.id, p.first_name, p.last_name, p.photo_url,
    (
      SELECT COALESCE(t.display_name, t.name)
      FROM team_players tp
      JOIN teams t   ON t.id = tp.team_id
      JOIN seasons s ON s.id = tp.season_id
      WHERE tp.player_id = p.id
        AND tp.is_active = TRUE
      ORDER BY s.is_current DESC, s.start_date DESC NULLS LAST
      LIMIT 1
    ) AS team_name
  FROM players p
  WHERE strpos(${unaccentExpr("p.first_name || ' ' || p.last_name")}, $1) > 0
     OR strpos(${unaccentExpr("p.last_name || ' ' || p.first_name")}, $1) > 0
  ORDER BY
    (${unaccentExpr("p.first_name || ' ' || p.last_name")} = $1) DESC,
    (${unaccentExpr("p.last_name || ' ' || p.first_name")} = $1) DESC,
    p.last_name ASC, p.first_name ASC
  LIMIT $2
`;

export const COMPETITION_QUERY = `
  SELECT
    comp.id, comp.slug, comp.name, comp.name_i18n, comp.short_name, comp.country, comp.scope,
    s.name AS season_name
  FROM competitions comp
  JOIN LATERAL (
    SELECT s2.name
    FROM seasons s2
    WHERE s2.competition_id = comp.id
      AND s2.data_quality = 'ok'
      AND EXISTS (SELECT 1 FROM matches m WHERE m.season_id = s2.id)
    ORDER BY s2.is_current DESC, s2.start_date DESC NULLS LAST
    LIMIT 1
  ) s ON TRUE
  WHERE comp.archived_at IS NULL
    AND comp.data_quality = 'ok'
    AND (
      strpos(${unaccentExpr('comp.name')}, $1) > 0
      OR strpos(${unaccentExpr("coalesce(comp.short_name, '')")}, $1) > 0
    )
  ORDER BY
    (${unaccentExpr('comp.name')} = $1) DESC,
    (strpos(${unaccentExpr('comp.name')}, $1) = 1) DESC,
    comp.name ASC
  LIMIT $2
`;

/**
 * GET /search?q=
 * Búsqueda global: clubes + equipos + jugadores + competiciones (todas las temporadas),
 * devueltos agrupados. Términos de menos de 2 caracteres → respuesta vacía.
 */
searchRouter.get('/', async (c) => {
  const normalized = normalizeSearchTerm(c.req.query('q') ?? '');
  const q = parseSearchQuery(normalized);
  if (!q) {
    return c.json({ query: normalized, total: 0, clubs: [], teams: [], players: [], competitions: [] });
  }

  try {
    const [teams, players, competitions, clubs] = await Promise.all([
      db.query<SearchTeamRow>(TEAM_QUERY, [q, SEARCH_LIMIT]),
      db.query<SearchPlayerRow>(PLAYER_QUERY, [q, SEARCH_LIMIT]),
      db.query<SearchCompetitionRow>(COMPETITION_QUERY, [q, SEARCH_LIMIT]),
      db.query<SearchClubRow>(CLUB_QUERY, [q, SEARCH_LIMIT]),
    ]);

    return c.json(buildSearchResults(q, teams.rows, players.rows, competitions.rows, clubs.rows));
  } catch (err) {
    captureRouteError(err, 'search] GET / error');
    logger.error({ err }, '[search] GET / error');
    return c.json({ error: 'Database error' }, 500);
  }
});
