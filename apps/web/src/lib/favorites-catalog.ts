/**
 * Catálogo de equipos para "Gestionar favoritos" (`/favorites`).
 *
 * La página obtiene las competiciones de `GET /competitions` (cada una con su
 * temporada de referencia) y necesita equipos para el buscador. Antes se elegía
 * UNA sola temporada y, si sus standings daban 404, la lista quedaba vacía.
 *
 * Aquí está la lógica PURA y testeable: qué temporadas consultar (con límite,
 * para no disparar decenas de fetch) y cómo agregar/deduplicar los equipos de
 * varias de ellas. El fetch vive en la página.
 */

import { normalizeSearchText } from '@sports/core/search-text';

/** Temporada de referencia tal como la devuelve `GET /competitions`. */
export interface FavoriteSeasonRef {
  id: string;
  isCurrent?: boolean;
  teamCount?: number;
}

/** Competición mínima que necesitamos de `GET /competitions`. */
export interface FavoriteComp {
  id: string;
  season?: FavoriteSeasonRef | null;
}

/** Equipo del catálogo (forma que consume la página). */
export interface FavoriteTeam {
  id: string;
  name: string;
  shortName: string | null;
}

/** Fila cruda de `GET /seasons/:id/standings` (acepta snake_case y camelCase). */
export interface RawStandingRow {
  team_id?: string | null;
  teamId?: string | null;
  team_name?: string | null;
  teamName?: string | null;
  team_short_name?: string | null;
  teamShortName?: string | null;
}

/** Tope de temporadas a consultar: evita ráfagas de fetch y rate limits. */
export const MAX_SEASON_FETCHES = 6;

/**
 * Selecciona, en orden de relevancia, las temporadas de las que cargar standings.
 *
 * Reglas:
 *  - Solo temporadas presentes en las competiciones (deduplicadas por id).
 *  - Si hay temporadas `isCurrent`, se prefieren esas (el resto se descarta).
 *  - Dentro del grupo, primero las de más equipos.
 *  - `envSeasonId` es el último recurso: solo si no hay ninguna candidata.
 *  - Se recorta a `limit` (por defecto `MAX_SEASON_FETCHES`).
 */
export function selectSeasonCandidates(
  comps: FavoriteComp[],
  opts: { envSeasonId?: string | null; limit?: number } = {}
): string[] {
  const { envSeasonId, limit = MAX_SEASON_FETCHES } = opts;

  // Deduplica por id de temporada quedándonos con la mejor señal (actual / más equipos).
  const byId = new Map<string, { isCurrent: boolean; teamCount: number }>();
  for (const c of comps) {
    const s = c.season;
    if (!s?.id) continue;
    const next = { isCurrent: !!s.isCurrent, teamCount: s.teamCount ?? 0 };
    const prev = byId.get(s.id);
    const better =
      !prev ||
      (next.isCurrent && !prev.isCurrent) ||
      (next.isCurrent === prev.isCurrent && next.teamCount > prev.teamCount);
    if (better) byId.set(s.id, next);
  }

  const all = [...byId.entries()].map(([id, v]) => ({ id, ...v }));
  const current = all.filter((s) => s.isCurrent);
  const pool = current.length ? current : all;
  pool.sort((a, b) => b.teamCount - a.teamCount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const ordered = pool.map((s) => s.id);
  // El env (id horneado en el build) puede estar vacío/obsoleto: solo como respaldo.
  if (ordered.length === 0 && envSeasonId) ordered.push(envSeasonId);

  return ordered.slice(0, Math.max(0, limit));
}

/** Normaliza una fila de standings a un equipo, o `null` si no tiene id. */
function normalizeStanding(row: RawStandingRow): FavoriteTeam | null {
  const id = row.team_id ?? row.teamId;
  if (!id) return null;
  return {
    id,
    name: row.team_name ?? row.teamName ?? '',
    shortName: row.team_short_name ?? row.teamShortName ?? null,
  };
}

/**
 * Agrega los equipos de varias temporadas deduplicando por id.
 * La primera aparición gana, pero los campos vacíos se completan con las
 * siguientes. Resultado ordenado por nombre.
 */
export function mergeStandingTeams(lists: RawStandingRow[][]): FavoriteTeam[] {
  const byId = new Map<string, FavoriteTeam>();
  for (const rows of lists) {
    for (const row of rows ?? []) {
      const team = normalizeStanding(row);
      if (!team) continue;
      const prev = byId.get(team.id);
      if (!prev) {
        byId.set(team.id, team);
        continue;
      }
      if (!prev.name && team.name) prev.name = team.name;
      if (!prev.shortName && team.shortName) prev.shortName = team.shortName;
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * ¿El equipo/liga casa con el término buscado? Ignora acentos y ñ para que
 * teclear sin tilde (lo habitual) encuentre nombres acentuados (#258).
 */
export function matchesFavoriteQuery(
  name: string,
  shortName: string | null | undefined,
  query: string,
): boolean {
  const q = normalizeSearchText(query.trim());
  if (!q) return true;
  return (
    normalizeSearchText(name).includes(q) ||
    normalizeSearchText(shortName ?? '').includes(q)
  );
}

/**
 * Filtra un catálogo de equipos o ligas por nombre o abreviatura, sin acentos.
 * Genérico para reutilizarlo con `FavoriteTeam` y con las ligas.
 */
export function filterFavorites<T extends { name: string; shortName?: string | null }>(
  items: T[],
  query: string,
): T[] {
  return items.filter((it) => matchesFavoriteQuery(it.name, it.shortName, query));
}
