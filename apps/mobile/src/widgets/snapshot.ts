import type { WidgetMatchData, WidgetState } from './types';

export interface MatchInput {
  id: string;
  homeTeamName: string;
  awayTeamName: string;
  homeScore?: number | null;
  awayScore?: number | null;
  status: string; // 'in_progress', 'live', 'finished', 'scheduled', etc.
  minute?: string | null;
  competitionName?: string;
  scheduledAt?: string;
  isLive?: boolean;
}

/**
 * Normaliza el estado para el widget:
 * - 'live' si está en juego (isLive === true o status in_progress/live/1h/2h)
 * - 'finished' si ha terminado
 * - 'scheduled' si aún no empieza
 */
export function normalizeWidgetStatus(status: string, isLive?: boolean): 'live' | 'finished' | 'scheduled' {
  if (isLive) return 'live';
  const s = status.toLowerCase();
  if (s === 'in_progress' || s === 'live' || s === '1p' || s === '2p' || s === 'ot') {
    return 'live';
  }
  if (s === 'finished' || s === 'final' || s === 'ft') {
    return 'finished';
  }
  return 'scheduled';
}

/**
 * Genera el deep link URI canónico para abrir la app en la ficha del partido.
 */
export function buildWidgetDeepLink(matchId: string): string {
  return `sticklive://match/${encodeURIComponent(matchId)}`;
}

/**
 * Construye el estado estructurado que consume el widget de la pantalla de inicio
 * (Android AppWidget o iOS WidgetKit).
 *
 * Prioridad para el partido destacado:
 * 1. Partidos en vivo que coincidan con favoritos del usuario.
 * 2. Cualquier partido en vivo.
 * 3. Próximo partido programado.
 * 4. Último partido finalizado.
 */
export function buildWidgetSnapshot(
  matches: MatchInput[],
  favoriteTeamNames: string[] = [],
  now: Date = new Date(),
): WidgetState {
  if (!matches || matches.length === 0) {
    return {
      hasMatches: false,
      featuredMatch: null,
      liveCount: 0,
      lastUpdated: now.toISOString(),
    };
  }

  const liveMatches = matches.filter(
    (m) => normalizeWidgetStatus(m.status, m.isLive) === 'live',
  );

  let chosen: MatchInput | undefined;

  if (liveMatches.length > 0) {
    const favSet = new Set(favoriteTeamNames.map((n) => n.trim().toLowerCase()));
    // Buscar si hay algún partido en vivo de un equipo favorito
    const favLive = liveMatches.find(
      (m) => favSet.has(m.homeTeamName.toLowerCase()) || favSet.has(m.awayTeamName.toLowerCase()),
    );
    chosen = favLive ?? liveMatches[0];
  } else {
    // Si no hay en vivo, buscar el próximo programado
    const scheduled = matches.filter(
      (m) => normalizeWidgetStatus(m.status, m.isLive) === 'scheduled',
    );
    if (scheduled.length > 0) {
      chosen = scheduled[0];
    } else {
      chosen = matches[0];
    }
  }

  if (!chosen) {
    return {
      hasMatches: false,
      featuredMatch: null,
      liveCount: 0,
      lastUpdated: now.toISOString(),
    };
  }

  const normStatus = normalizeWidgetStatus(chosen.status, chosen.isLive);
  const featuredMatch: WidgetMatchData = {
    matchId: chosen.id,
    homeTeam: chosen.homeTeamName,
    awayTeam: chosen.awayTeamName,
    homeScore: chosen.homeScore ?? null,
    awayScore: chosen.awayScore ?? null,
    status: normStatus,
    minute: chosen.minute ?? null,
    competition: chosen.competitionName ?? 'Stick Live',
    deepLinkUrl: buildWidgetDeepLink(chosen.id),
  };

  return {
    hasMatches: true,
    featuredMatch,
    liveCount: liveMatches.length,
    lastUpdated: now.toISOString(),
  };
}
