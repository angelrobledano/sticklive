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
  /** API ≥ 2026-10-30: club y sección, para distinguir «CD Claret» ×5. */
  clubId?: string | null;
  clubSlug?: string | null;
  gender?: string | null;
  ageCategory?: string | null;
  squadLevel?: number | null;
  competitionName?: string | null;
}

export interface SearchClub {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  crestUrl: string | null;
  teamCount: number;
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
  /** API ≥ 2026-10-30. */
  clubs?: SearchClub[];
}

/**
 * Clubes primero y, en Equipos, solo los que no cuelgan de un club ya listado
 * (sus secciones se ven en la ficha del club). Cada club lleva un equipo suyo
 * para pintar el escudo cuando el club no tiene uno propio.
 */
export function arrangeSearchResults(r: SearchResults): {
  clubs: (SearchClub & { shieldTeamId: string | null; firstTeam: SearchTeam | null })[];
  teams: SearchTeam[];
} {
  const clubs = r.clubs ?? [];
  const listed = new Set(clubs.map((c) => c.id));
  // Primer equipo (auditoría UX 03/11/2026): sénior de menor nivel, masculino
  // antes que femenino. Buscar «liceo» lleva directo a su equipo de OK Liga.
  const firstTeam = (clubId: string): SearchTeam | null => r.teams
    .filter((t) => t.clubId === clubId && t.ageCategory === 'senior')
    .sort((a, b) => (a.squadLevel ?? 9) - (b.squadLevel ?? 9) || Number(a.gender !== 'male') - Number(b.gender !== 'male'))[0] ?? null;
  return {
    clubs: clubs.map((c) => ({ ...c, shieldTeamId: r.teams.find((t) => t.clubId === c.id)?.id ?? null, firstTeam: firstTeam(c.id) })),
    teams: r.teams.filter((t) => !t.clubId || !listed.has(t.clubId)),
  };
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
    clubs: res.clubs ?? [],
  };
}
