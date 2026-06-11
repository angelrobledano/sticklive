'use client';

import { useState, useEffect, useCallback } from 'react';
import { track, setPersonProps } from '@/lib/analytics';
import { syncPushConfig } from '@/lib/push';

const STORAGE_KEY = 'rink-favorites';

export function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>([]);
  // Evita hidratación asíncrona: montamos en cliente
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setFavorites(JSON.parse(stored) as string[]);
    } catch {
      // localStorage no disponible (SSR, iframe privado, etc.)
    }
  }, []);

  const toggle = useCallback((teamId: string) => {
    setFavorites((prev) => {
      const adding = !prev.includes(teamId);
      const next = adding
        ? [...prev, teamId]
        : prev.filter((id) => id !== teamId);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch { /* noop */ }
      track(adding ? 'favorite_added' : 'favorite_removed', {
        kind: 'team', ref_id: teamId, total_favorites: next.length,
      });
      setPersonProps({ favorite_teams: next.length });
      void syncPushConfig(); // el emisor de push segmenta por favoritos
      return next;
    });
  }, []);

  const isFavorite = useCallback(
    (teamId: string) => favorites.includes(teamId),
    [favorites]
  );

  // ── Ligas favoritas (clave separada, misma mecánica) ──────────────────────
  const [leagues, setLeagues] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LEAGUES_KEY);
      if (stored) setLeagues(JSON.parse(stored) as string[]);
    } catch { /* noop */ }
  }, []);

  const toggleLeague = useCallback((competitionId: string) => {
    setLeagues((prev) => {
      const adding = !prev.includes(competitionId);
      const next = adding
        ? [...prev, competitionId]
        : prev.filter((id) => id !== competitionId);
      try { localStorage.setItem(LEAGUES_KEY, JSON.stringify(next)); } catch { /* noop */ }
      track(adding ? 'favorite_added' : 'favorite_removed', {
        kind: 'league', ref_id: competitionId, total_favorites: next.length,
      });
      return next;
    });
  }, []);

  const isLeagueFavorite = useCallback(
    (competitionId: string) => leagues.includes(competitionId),
    [leagues]
  );

  // ── Jugadores favoritos (clave separada + mapa de nombres para listados) ──
  const [players, setPlayers] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PLAYERS_KEY);
      if (stored) setPlayers(JSON.parse(stored) as string[]);
    } catch { /* noop */ }
  }, []);

  const togglePlayer = useCallback((playerId: string, name?: string) => {
    setPlayers((prev) => {
      const adding = !prev.includes(playerId);
      const next = adding
        ? [...prev, playerId]
        : prev.filter((id) => id !== playerId);
      try {
        localStorage.setItem(PLAYERS_KEY, JSON.stringify(next));
        // Mapa id→nombre: permite listar "Mis jugadores" sin N fetches
        const names = JSON.parse(localStorage.getItem(FAV_NAMES_KEY) ?? '{}') as Record<string, string>;
        if (adding && name) names[playerId] = name;
        if (!adding) delete names[playerId];
        localStorage.setItem(FAV_NAMES_KEY, JSON.stringify(names));
      } catch { /* noop */ }
      track(adding ? 'favorite_added' : 'favorite_removed', {
        kind: 'player', ref_id: playerId, total_favorites: next.length,
      });
      return next;
    });
  }, []);

  const isPlayerFavorite = useCallback(
    (playerId: string) => players.includes(playerId),
    [players]
  );

  return {
    favorites, toggle, isFavorite,
    leagues, toggleLeague, isLeagueFavorite,
    players, togglePlayer, isPlayerFavorite,
    mounted,
  };
}

/** Nombres de jugadores favoritos guardados al seguirlos (para listados) */
export function getFavNames(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(FAV_NAMES_KEY) ?? '{}'); } catch { return {}; }
}

const LEAGUES_KEY = 'rink-fav-leagues';
const PLAYERS_KEY = 'rink-fav-players';
const FAV_NAMES_KEY = 'rink-fav-names';
