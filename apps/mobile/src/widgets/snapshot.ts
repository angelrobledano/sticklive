import type { WidgetMatchData, WidgetState } from './types';

export interface MatchInput {
  id: string;
  homeTeamName: string;
  awayTeamName: string;
  homeScore?: number | null;
  awayScore?: number | null;
  homeFouls?: number | null;
  awayFouls?: number | null;
  status: string; // 'in_progress', 'live', 'finished', 'scheduled', etc.
  minute?: string | null;
  competitionName?: string;
  competitionTier?: number | null;
  scheduledAt?: string;
  isLive?: boolean;
  isHalftime?: boolean;
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
 * Detecta el nivel de la competición (1 = máxima categoría nacional/europea, 2 = plata/segunda, 3 = bronce/regional).
 */
export function detectCompetitionTier(tier?: number | null, name?: string): number {
  if (tier && tier > 0) return tier;
  if (!name) return 4;
  const lower = name.toLowerCase();
  if (lower.includes('ok liga') && !lower.includes('plata') && !lower.includes('bronce')) return 1;
  if (lower.includes('champions') || lower.includes('wse cup') || lower.includes('serie a1') || lower.includes('supercopa')) return 1;
  if (lower.includes('plata') || lower.includes('serie a2') || lower.includes('1ª división') || lower.includes('coppa italia')) return 2;
  if (lower.includes('nacional') || lower.includes('serie b')) return 3;
  return 4;
}

/**
 * Pondera un partido para determinar cuál debe ser el destacado del widget:
 * 1. Partidos en vivo (máxima prioridad ~1M puntos), bonificados por favoritos del usuario y división de élite.
 * 2. Próximos partidos programados (~100k puntos), priorizando favoritos y proximidad horaria al momento actual.
 * 3. Partidos finalizados (~10k puntos), bonificando favoritos y premiando recencia (el más reciente gana al más antiguo).
 */
export function scoreMatchInput(
  m: MatchInput,
  favoriteTeamNames: string[] = [],
  favoriteLeagueNames: string[] = [],
  nowMs: number = Date.now(),
): number {
  const normStatus = normalizeWidgetStatus(m.status, m.isLive);
  const favTeams = new Set(favoriteTeamNames.map((t) => t.trim().toLowerCase()));
  const favLeagues = new Set(favoriteLeagueNames.map((l) => l.trim().toLowerCase()));

  const homeName = m.homeTeamName.trim().toLowerCase();
  const awayName = m.awayTeamName.trim().toLowerCase();
  const compName = (m.competitionName ?? '').trim().toLowerCase();

  const isFavTeam = favTeams.has(homeName) || favTeams.has(awayName);
  const isFavLeague = compName.length > 0 && favLeagues.has(compName);
  const tier = detectCompetitionTier(m.competitionTier, m.competitionName);

  let scheduledMs = 0;
  if (m.scheduledAt) {
    const parsed = new Date(m.scheduledAt).getTime();
    if (!Number.isNaN(parsed)) scheduledMs = parsed;
  }

  let score = 0;

  if (normStatus === 'live') {
    score += 1_000_000;
    if (isFavTeam) score += 500_000;
    if (isFavLeague) score += 200_000;
    if (tier === 1) score += 50_000;
    else if (tier === 2) score += 20_000;
    else if (tier === 3) score += 5_000;
    else score += 1_000;
    if (m.isHalftime) score += 500;
  } else if (normStatus === 'scheduled') {
    score += 100_000;
    if (isFavTeam) score += 300_000;
    if (isFavLeague) score += 100_000;
    if (tier === 1) score += 30_000;
    else if (tier === 2) score += 10_000;
    else if (tier === 3) score += 3_000;
    else score += 500;

    if (scheduledMs > 0) {
      const diffMinutes = Math.floor((scheduledMs - nowMs) / 60000);
      if (diffMinutes >= -15 && diffMinutes <= 180) {
        // Empieza en las próximas 3 horas (o acaba de arrancar)
        score += Math.max(0, (180 - diffMinutes) * 100);
      } else if (diffMinutes > 180 && diffMinutes <= 720) {
        // Empieza en las próximas 12 horas
        score += Math.max(0, (720 - diffMinutes) * 10);
      } else if (diffMinutes < -15) {
        // Fecha pasada pero marcado como scheduled (stale)
        score -= 50_000;
      }
    }
  } else {
    // Finalizado
    score += 10_000;
    if (isFavTeam) score += 50_000;
    if (isFavLeague) score += 20_000;
    if (tier === 1) score += 10_000;
    else if (tier === 2) score += 5_000;
    else if (tier === 3) score += 2_000;
    else score += 500;

    // Recency: el partido que finalizó más recientemente puntúa más alto que el más antiguo
    if (scheduledMs > 0) {
      const hoursAgo = Math.max(0, Math.floor((nowMs - scheduledMs) / 3600000));
      score += Math.max(0, (48 - hoursAgo) * 500);
    }
  }

  return score;
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
 * Prioridad ponderada:
 * 1. Partidos en vivo (priorizando favoritos del usuario y división de élite).
 * 2. Próximos partidos programados (priorizando favoritos y cercanía temporal a ahora).
 * 3. Últimos partidos finalizados (priorizando favoritos y recencia real, evitando mostrar el partido más antiguo del día anterior).
 */
export function buildWidgetSnapshot(
  matches: MatchInput[],
  favoriteTeamNames: string[] = [],
  now: Date = new Date(),
  favoriteLeagueNames: string[] = [],
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

  const nowMs = now.getTime();
  let chosen: MatchInput | undefined;
  let bestScore = -Infinity;

  for (const m of matches) {
    const s = scoreMatchInput(m, favoriteTeamNames, favoriteLeagueNames, nowMs);
    if (s > bestScore) {
      bestScore = s;
      chosen = m;
    }
  }

  if (!chosen) {
    chosen = matches[0];
  }

  const normStatus = normalizeWidgetStatus(chosen.status, chosen.isLive);
  const featuredMatch: WidgetMatchData = {
    matchId: chosen.id,
    homeTeam: chosen.homeTeamName,
    awayTeam: chosen.awayTeamName,
    homeScore: chosen.homeScore ?? null,
    awayScore: chosen.awayScore ?? null,
    homeFouls: chosen.homeFouls ?? null,
    awayFouls: chosen.awayFouls ?? null,
    isHalftime: chosen.isHalftime ?? false,
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
