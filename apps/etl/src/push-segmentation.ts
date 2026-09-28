/**
 * Segmentación PURA de notificaciones push: dado un preset por entidad y los
 * favoritos de una suscripción, decide si un evento concreto debe entregarse.
 *
 * Extraído de push-dispatcher.ts (que arrastra `db`/`webpush`) para poder fijar
 * la regla con tests unitarios, igual que push-diff.ts para el diff.
 */
import type { NotificationPreset } from '@sports/shared-types';

export type PushEventType =
  | 'start' | 'goal' | 'blue_card' | 'direct_foul' | 'red_card'
  | 'overtime' | 'penalties' | 'final';

/** Lo que la segmentación necesita de una suscripción (subconjunto de SubRow). */
export interface SubPrefs {
  fav_teams: string[];
  fav_leagues: string[];
  fav_players: string[];
  /** Mapa "<tipo>:<id>" → preset. Entidad seguida sin preset → 'complete'. */
  presets: Record<string, string>;
}

// Cada preset es una colección de tipos de evento (no booleanos sueltos), para
// poder ampliar el catálogo sin rediseñar la segmentación.
export const PRESET_EVENTS: Record<NotificationPreset, PushEventType[]> = {
  complete:   ['start', 'goal', 'blue_card', 'direct_foul', 'red_card', 'overtime', 'penalties', 'final'],
  // 'start' incluido: es el preset por defecto al seguir y el inicio del partido
  // es el aviso más motivador (#265).
  key_events: ['start', 'goal', 'blue_card', 'direct_foul', 'red_card', 'overtime', 'penalties', 'final'],
  results:    ['start', 'overtime', 'penalties', 'final'],
  silent:     [],
};

/** Preset efectivo de una entidad seguida; "seguido sin preset" = complete (compat). */
export function effectivePreset(sub: SubPrefs, key: string): NotificationPreset {
  const p = sub.presets?.[key];
  return (p === 'complete' || p === 'key_events' || p === 'results' || p === 'silent') ? p : 'complete';
}

/**
 * ¿La suscripción quiere este evento? Resuelve las entidades por las que sigue el
 * partido (cualquiera de los dos equipos, la competición o el jugador implicado) y
 * comprueba si el preset de ALGUNA de ellas incluye el tipo de evento.
 */
export function wants(
  sub: SubPrefs, ev: PushEventType,
  teamIds: string[], competitionId: string | null, playerId: string | null,
): boolean {
  const keys: string[] = [];
  for (const t of teamIds) if (t && (sub.fav_teams ?? []).includes(t)) keys.push(`team:${t}`);
  if (competitionId && (sub.fav_leagues ?? []).includes(competitionId)) keys.push(`competition:${competitionId}`);
  if (playerId && (sub.fav_players ?? []).includes(playerId)) keys.push(`player:${playerId}`);
  if (keys.length === 0) return false;
  return keys.some((k) => PRESET_EVENTS[effectivePreset(sub, k)].includes(ev));
}
