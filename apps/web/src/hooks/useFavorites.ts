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

  return { favorites, toggle, isFavorite, leagues, toggleLeague, isLeagueFavorite, mounted };
}

const LEAGUES_KEY = 'rink-fav-leagues';
