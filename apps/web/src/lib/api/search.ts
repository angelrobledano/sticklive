import { apiFetch } from './core';

/**
 * Búsqueda global (#255): equipos + jugadores + competiciones en un solo
 * endpoint de la API, agrupados. La web solo enruta y pinta.
 *
 * Vive en su propio módulo para no tocar `client.ts`/`core.ts` (barrel y fetch
 * compartidos). Usa `apiFetch` para heredar el manejo de errores de la capa.
 */

export interface SearchTeam {
  id: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  country: string | null;
}

export interface SearchPlayer {
  id: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  teamName: string | null;
}

export interface SearchCompetition {
  id: string;
  name: string;
  nameI18n: Record<string, string> | null;
  shortName: string | null;
  country: string | null;
  scope: string | null;
  seasonName: string | null;
  /** Slug para la URL legible (Plan A). Opcional: API antigua. */
  slug?: string | null;
}

export interface SearchResults {
  query: string;
  total: number;
  teams: SearchTeam[];
  players: SearchPlayer[];
  competitions: SearchCompetition[];
}

/** Longitud mínima para lanzar una búsqueda (coincide con la API). */
export const SEARCH_MIN_LENGTH = 2;

/** Recorta y colapsa espacios del término antes de enviarlo. */
export function normalizeSearchQuery(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/\s+/g, ' ');
}

/** ¿El término tiene longitud suficiente para buscar? */
export function isSearchable(query: string): boolean {
  return normalizeSearchQuery(query).length >= SEARCH_MIN_LENGTH;
}

/** Lanza la búsqueda global. Lanza si la API responde con error. */
export async function searchAll(query: string): Promise<SearchResults> {
  const q = normalizeSearchQuery(query);
  const res = await apiFetch<SearchResults>(`/search?q=${encodeURIComponent(q)}`, {
    cache: 'no-store',
  });
  return {
    query: res.query,
    total: res.total,
    teams: res.teams ?? [],
    players: res.players ?? [],
    competitions: res.competitions ?? [],
  };
}
