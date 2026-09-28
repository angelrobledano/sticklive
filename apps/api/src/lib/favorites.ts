/**
 * Normalización de favoritos para el merge (#333).
 *
 * Pura y testeable: convierte los arrays del cliente en pares (kind, refId)
 * válidos, descartando ids que no son UUID y acotando el tamaño por tipo.
 *
 * El merge los persiste en UNA sola sentencia (unnest) dentro de una
 * transacción, en vez de un INSERT secuencial por favorito (hasta 600
 * round-trips).
 */
import { isUuid } from './uuid.js';

export type FavoriteKind = 'team' | 'league' | 'player';

export interface FavoritePairsInput {
  teams?: string[];
  leagues?: string[];
  players?: string[];
}

export interface FavoritePair {
  kind: FavoriteKind;
  refId: string;
}

/** Tope defensivo de ids por tipo (mismo valor que la implementación previa). */
export const MAX_FAVORITES_PER_KIND = 200;

export function buildFavoritePairs(input: FavoritePairsInput): FavoritePair[] {
  const out: FavoritePair[] = [];
  const add = (kind: FavoriteKind, ids?: string[]): void => {
    // Se corta ANTES de filtrar, como antes: sólo se miran los primeros 200 ids
    // de cada lista (el cliente no debe mandar más).
    for (const id of (ids ?? []).slice(0, MAX_FAVORITES_PER_KIND)) {
      if (isUuid(id)) out.push({ kind, refId: id });
    }
  };
  add('team', input.teams);
  add('league', input.leagues);
  add('player', input.players);
  return out;
}
