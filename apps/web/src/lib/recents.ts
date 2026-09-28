'use client';

/**
 * Historial local de partidos vistos (#270).
 *
 * Guardamos los últimos partidos abiertos en localStorage para poder volver a
 * ellos aunque no se recuerde la ruta. La lista es "más reciente primero",
 * deduplicada por id de partido y acotada a `RECENTS_LIMIT`.
 *
 * La lógica de la lista (`upsertRecent` / `parseRecents`) es pura y testeable;
 * los wrappers de localStorage solo se ejecutan en cliente (SSR-safe).
 */

export const RECENTS_KEY = 'rink-recent-matches';

/** Nº máximo de partidos recordados (suficiente y sin inflar localStorage). */
export const RECENTS_LIMIT = 12;

export interface RecentMatch {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeName: string;
  awayName: string;
  competitionId: string | null;
  competitionName: string | null;
  /** Epoch ms del momento en que se abrió la ficha. */
  viewedAt: number;
}

/**
 * Añade un partido al frente de la lista, eliminando cualquier copia previa
 * (dedupe por id) y recortando al límite. No muta `list`.
 */
export function upsertRecent(
  list: RecentMatch[],
  item: RecentMatch,
  limit: number = RECENTS_LIMIT,
): RecentMatch[] {
  const rest = list.filter((r) => r.id !== item.id);
  return [item, ...rest].slice(0, limit);
}

/** Valida la forma mínima de un registro guardado antes de confiar en él. */
function isRecentMatch(value: unknown): value is RecentMatch {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.homeTeamId === 'string' &&
    typeof r.awayTeamId === 'string' &&
    typeof r.homeName === 'string' &&
    typeof r.awayName === 'string' &&
    (r.competitionId == null || typeof r.competitionId === 'string') &&
    (r.competitionName == null || typeof r.competitionName === 'string') &&
    typeof r.viewedAt === 'number'
  );
}

/**
 * Lee una lista serializada y descarta entradas corruptas o de formatos
 * antiguos. Nunca lanza: ante cualquier duda devuelve [].
 */
export function parseRecents(raw: string | null): RecentMatch[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentMatch);
  } catch {
    return [];
  }
}

/** Devuelve los partidos vistos recientemente (vacío en SSR o si falla). */
export function getRecentMatches(): RecentMatch[] {
  if (typeof window === 'undefined') return [];
  try {
    return parseRecents(window.localStorage.getItem(RECENTS_KEY));
  } catch {
    return [];
  }
}

/** Registra la apertura de una ficha de partido (más reciente primero). */
export function recordRecentMatch(item: RecentMatch): void {
  if (typeof window === 'undefined') return;
  try {
    const next = upsertRecent(getRecentMatches(), item);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Almacenamiento no disponible (modo privado, cuota): se ignora en silencio.
  }
}
