import type { QueryClient } from '@tanstack/react-query';
import { qk } from '@/src/hooks/queries';
import type { FavoriteKind } from '@/src/hooks/favorites';
import type {
  CompetitionsResponse,
  PlayerDetail,
  SearchResults,
  StandingsResponse,
  TeamDetail,
} from '@/src/lib/api/types';

/**
 * Nombre visible de un favorito desde la CACHÉ de queries ya visitadas (fichas
 * team/player, standings, competitions, search), sin inventar endpoints de
 * bulk. Compartido por el tab de favoritos (Task 3.3) y la pantalla de
 * notificaciones (Task 4.2).
 *
 * Limitación v1 del plan: si el nombre no está en caché, placeholder genérico.
 * NO hay endpoint de bulk (se evaluará en M5 si la UX lo pide).
 */

/** Placeholders cuando el nombre no está en caché: claves i18n resueltas con
 * t() en el punto de uso (Task 5.2; singulares nuevos en los 5 locales bajo
 * favorites.placeholder_*). La lib sigue siendo pura, sin React. */
export const PLACEHOLDER_KEY: Record<FavoriteKind, string> = {
  team: 'favorites.placeholder_team',
  league: 'favorites.placeholder_league',
  player: 'favorites.placeholder_player',
};

export function resolveFavoriteName(qc: QueryClient, kind: FavoriteKind, id: string): string | null {
  if (kind === 'team') {
    const detail = qc.getQueryData<TeamDetail>(qk.team(id));
    if (detail) return detail.team.name;
    for (const q of qc.getQueryCache().findAll({ queryKey: ['search'] })) {
      const hit = (q.state.data as SearchResults | undefined)?.teams.find((x) => x.id === id);
      if (hit) return hit.name;
    }
    for (const q of qc.getQueryCache().findAll({ queryKey: ['standings'] })) {
      const row = (q.state.data as StandingsResponse | undefined)?.standings.find((r) => r.team_id === id);
      if (row) return row.team_short_name ?? row.team_name;
    }
    return null;
  }
  if (kind === 'player') {
    const detail = qc.getQueryData<PlayerDetail>(qk.player(id));
    if (detail) return `${detail.player.firstName} ${detail.player.lastName}`;
    for (const q of qc.getQueryCache().findAll({ queryKey: ['search'] })) {
      const hit = (q.state.data as SearchResults | undefined)?.players.find((x) => x.id === id);
      if (hit) return `${hit.firstName} ${hit.lastName}`;
    }
    return null;
  }
  // kind 'league': el refId es id de COMPETICIÓN (nomenclatura del API).
  const comps = qc.getQueryData<CompetitionsResponse>(qk.competitions);
  const comp = comps?.competitions.find((c) => c.id === id);
  if (comp) return comp.name;
  for (const q of qc.getQueryCache().findAll({ queryKey: ['search'] })) {
    const hit = (q.state.data as SearchResults | undefined)?.competitions.find((x) => x.id === id);
    if (hit) return hit.name;
  }
  return null;
}
