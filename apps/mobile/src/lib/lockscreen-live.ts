import * as Notifications from 'expo-notifications';
import { BRAND } from '@sports/brand';
import type { MatchSummary } from '@sports/core/api';
import { clubName } from '@sports/core/names';
import { isEffectivelyLive } from '@/src/lib/time';

export interface FollowedEntities {
  teams: string[];
  leagues: string[];
  players?: string[];
  playerTeams?: string[];
}

export type FollowReason = 'team' | 'league' | 'player';

export interface MatchFollowStatus {
  isFollowed: boolean;
  reason?: FollowReason;
}

/**
 * Determina si un partido corresponde a una entidad seguida por el usuario:
 * 1. Equipo seguido (local o visitante).
 * 2. Liga / competición seguida.
 * 3. Jugador seguido cuyo equipo disputa el encuentro.
 */
export function isMatchFollowed(
  match: MatchSummary,
  followed: FollowedEntities,
): MatchFollowStatus {
  const homeId = match.homeTeam.id;
  const awayId = match.awayTeam.id;

  if (followed.teams.includes(homeId) || followed.teams.includes(awayId)) {
    return { isFollowed: true, reason: 'team' };
  }

  if (match.competitionId && followed.leagues.includes(match.competitionId)) {
    return { isFollowed: true, reason: 'league' };
  }

  if (
    followed.playerTeams &&
    (followed.playerTeams.includes(homeId) || followed.playerTeams.includes(awayId))
  ) {
    return { isFollowed: true, reason: 'player' };
  }

  return { isFollowed: false };
}

/**
 * Filtra los partidos que están actualmente en directo y pertenecen a los seguidos.
 */
export function getFollowedLiveMatches(
  matches: MatchSummary[] | undefined | null,
  followed: FollowedEntities,
): MatchSummary[] {
  if (!matches || matches.length === 0) return [];

  return matches.filter((m) => {
    if (!isEffectivelyLive(m.status, m.scheduledAt)) return false;
    return isMatchFollowed(m, followed).isFollowed;
  });
}

/**
 * Identificador estable de notificación por partido para que Android
 * reemplace en su sitio la notificación existente sin duplicados.
 */
export function getNotificationIdForMatch(matchId: string): string {
  return `live-match-${matchId}`;
}

/**
 * Construye el payload de notificación optimizado para la pantalla de bloqueo:
 * - ongoing / sticky: true (no se descarta accidentalmente con swipe).
 * - autoDismiss: false.
 * - Prioridad HIGH (aparece visible en la pantalla de bloqueo).
 * - Contenido legible de un vistazo: Marcador y equipos claros.
 * - Deep link `/match/<id>` al tocar.
 */
export function buildLockScreenNotification(match: MatchSummary): {
  identifier: string;
  content: Notifications.NotificationContentInput;
} {
  const homeDisplay = clubName(match.homeTeam.name) || match.homeTeam.shortName || match.homeTeam.name;
  const awayDisplay = clubName(match.awayTeam.name) || match.awayTeam.shortName || match.awayTeam.name;

  const statusLabel = match.isHalftime ? 'Descanso' : match.status === 'live' ? 'En directo' : 'En juego';
  const compPrefix = match.competitionName ? `${match.competitionName} · ` : '';
  const title = `🔴 ${compPrefix}${statusLabel}`;

  const homeScore = match.score.home ?? 0;
  const awayScore = match.score.away ?? 0;
  const body = `${homeDisplay} ${homeScore} - ${awayScore} ${awayDisplay}`;
  const subtitle = `${match.homeTeam.name} vs ${match.awayTeam.name}`;

  return {
    identifier: getNotificationIdForMatch(match.id),
    content: {
      title,
      body,
      subtitle,
      color: BRAND.granate,
      sticky: true,
      autoDismiss: false,
      priority: Notifications.AndroidNotificationPriority.HIGH,
      data: {
        type: 'live_lockscreen',
        matchId: match.id,
        urlPath: `/match/${match.id}`,
      },
    },
  };
}

export interface LockScreenSyncOptions {
  platform: string;
  isEnabled: boolean;
  matches: MatchSummary[] | undefined | null;
  followed: FollowedEntities;
  activeMatchIds: Set<string>;
  channelId: string;
  scheduleNotification: (
    identifier: string,
    content: Notifications.NotificationContentInput,
    channelId: string,
  ) => void;
  dismissNotification: (identifier: string) => void;
}

/**
 * Función PURA que sincroniza el estado de las notificaciones de pantalla de bloqueo:
 * - Programa / actualiza en Android los partidos en vivo que el usuario sigue.
 * - Descarta partidos que han terminado, que ya no son seguidos o si se desactiva la función.
 * - Devuelve el nuevo conjunto de IDs de partidos activos.
 */
export function syncLockScreenLiveMatches(options: LockScreenSyncOptions): Set<string> {
  const {
    platform,
    isEnabled,
    matches,
    followed,
    activeMatchIds,
    channelId,
    scheduleNotification,
    dismissNotification,
  } = options;

  if (platform !== 'android' || !isEnabled) {
    for (const matchId of activeMatchIds) {
      dismissNotification(getNotificationIdForMatch(matchId));
    }
    return new Set<string>();
  }

  const liveMatches = getFollowedLiveMatches(matches, followed);
  const newActiveIds = new Set<string>();

  for (const match of liveMatches) {
    newActiveIds.add(match.id);
    const notif = buildLockScreenNotification(match);
    scheduleNotification(notif.identifier, notif.content, channelId);
  }

  for (const prevId of activeMatchIds) {
    if (!newActiveIds.has(prevId)) {
      dismissNotification(getNotificationIdForMatch(prevId));
    }
  }

  return newActiveIds;
}
