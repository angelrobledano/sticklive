'use client';

/**
 * Preferencias de notificación POR ENTIDAD (equipos, competiciones, jugadores).
 *
 * Modelo: por defecto un favorito tiene las notificaciones ACTIVADAS. Aquí solo
 * guardamos los que el usuario ha DESACTIVADO (lista de exclusión por tipo), así
 * los favoritos nuevos quedan activados automáticamente.
 *
 * Efecto real: el cliente envía como `fav_teams` solo los equipos activados
 * (ver push.ts), y el emisor del ETL ya segmenta por ahí. Competiciones y
 * jugadores se guardan para cuando el emisor tenga disparadores propios.
 */

export type NotifKind = 'team' | 'league' | 'player';

const KEY = 'rink-notif-disabled';

interface DisabledMap { teams: string[]; leagues: string[]; players: string[] }

function bucket(kind: NotifKind): keyof DisabledMap {
  return kind === 'team' ? 'teams' : kind === 'league' ? 'leagues' : 'players';
}

export function getDisabled(): DisabledMap {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DisabledMap>;
    return {
      teams:   Array.isArray(raw.teams)   ? raw.teams   : [],
      leagues: Array.isArray(raw.leagues) ? raw.leagues : [],
      players: Array.isArray(raw.players) ? raw.players : [],
    };
  } catch {
    return { teams: [], leagues: [], players: [] };
  }
}

/** Equipos con notificación activada = favoritos menos los desactivados. */
export function enabledTeams(favoriteTeamIds: string[]): string[] {
  const off = new Set(getDisabled().teams);
  return favoriteTeamIds.filter((id) => !off.has(id));
}

/** Competiciones con notificación activada. */
export function enabledLeagues(favoriteLeagueIds: string[]): string[] {
  const off = new Set(getDisabled().leagues);
  return favoriteLeagueIds.filter((id) => !off.has(id));
}

/** Jugadores con notificación activada. */
export function enabledPlayers(favoritePlayerIds: string[]): string[] {
  const off = new Set(getDisabled().players);
  return favoritePlayerIds.filter((id) => !off.has(id));
}

export function isNotifEnabled(kind: NotifKind, id: string): boolean {
  return !getDisabled()[bucket(kind)].includes(id);
}

/** Activa/desactiva la notificación de una entidad. Devuelve el nuevo estado. */
export function setNotifEnabled(kind: NotifKind, id: string, enabled: boolean): boolean {
  const map = getDisabled();
  const list = map[bucket(kind)];
  const has = list.includes(id);
  if (enabled && has) map[bucket(kind)] = list.filter((x) => x !== id);
  else if (!enabled && !has) map[bucket(kind)] = [...list, id];
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* noop */ }
  return enabled;
}
