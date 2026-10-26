import { useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/src/context/AuthContext';
import { useFavorites, useLocalFavorites } from '@/src/hooks/favorites';
import { useCurrentMatches } from '@/src/hooks/queries';
import { getPlayerTeams } from '@/src/lib/favorite-names';
import {
  getNotificationIdForMatch,
  syncLockScreenLiveMatches,
} from '@/src/lib/lockscreen-live';
import { loadPushPrefs, NOTIFICATION_CHANNELS } from '@/src/lib/push';

export const PUSH_PREFS_QUERY_KEY = ['pushPrefs'] as const;

/**
 * Hook que sincroniza en tiempo real los partidos en juego de ligas,
 * equipos y jugadores seguidos con notificaciones en la pantalla de bloqueo.
 *
 * Características:
 * - Ongoing / sticky en Android para permanecer fija en pantalla de bloqueo.
 * - Visibilidad pública (AndroidNotificationVisibility.PUBLIC).
 * - Marcador actualizado en directo sin sonidos ni vibraciones invasivas.
 * - Descarte automático cuando el partido finaliza o el usuario deja de seguirlo.
 */
export function useLockScreenLiveMatches() {
  const { session } = useSession();
  const token = session?.token;

  const serverFavs = useFavorites(token);
  const localFavs = useLocalFavorites(!token);
  const favs = token ? serverFavs.data : localFavs.data;

  const currentMatchesQuery = useCurrentMatches();
  const matches = currentMatchesQuery.data;

  const prefsQuery = useQuery({
    queryKey: PUSH_PREFS_QUERY_KEY,
    queryFn: loadPushPrefs,
    staleTime: 60_000,
  });

  const isEnabled = prefsQuery.data?.config?.liveLockscreenEnabled !== false;

  const followedTeams = useMemo(() => favs?.teams ?? [], [favs?.teams]);
  const followedLeagues = useMemo(() => favs?.leagues ?? [], [favs?.leagues]);
  const followedPlayers = useMemo(() => favs?.players ?? [], [favs?.players]);

  const playerTeams = useMemo(() => {
    return getPlayerTeams(followedPlayers);
  }, [followedPlayers]);

  const activeMatchIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    activeMatchIdsRef.current = syncLockScreenLiveMatches({
      platform: Platform.OS,
      isEnabled,
      matches,
      followed: {
        teams: followedTeams,
        leagues: followedLeagues,
        players: followedPlayers,
        playerTeams,
      },
      activeMatchIds: activeMatchIdsRef.current,
      channelId: NOTIFICATION_CHANNELS.liveLockscreen.id,
      scheduleNotification: (identifier, content, channelId) => {
        void Notifications.scheduleNotificationAsync({
          identifier,
          content,
          trigger: { channelId },
        }).catch((err: unknown) => {
          console.warn('[lockscreen-live] fallo al actualizar notificación de partido', err);
        });
      },
      dismissNotification: (identifier) => {
        void Notifications.dismissNotificationAsync(identifier).catch(() => {});
      },
    });
  }, [matches, isEnabled, followedTeams, followedLeagues, followedPlayers, playerTeams]);

  // Al desmontar (p. ej. cierre de la app) limpiamos notificaciones temporales
  useEffect(() => {
    return () => {
      for (const matchId of activeMatchIdsRef.current) {
        void Notifications.dismissNotificationAsync(getNotificationIdForMatch(matchId)).catch(
          () => {},
        );
      }
      activeMatchIdsRef.current.clear();
    };
  }, []);
}
