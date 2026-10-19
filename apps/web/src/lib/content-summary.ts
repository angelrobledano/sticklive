import type { SeasonLeader, SeasonMatch, SeasonOverview, SeasonStats } from '@/lib/api/types';
import { playerDisplayName, playerNameFromRaw } from '@/lib/names';

/** Resumen server-rendered para fichas. Nada de textos si el dato es null. */

export interface RecentMatch {
  id: string;
  date: string | null;
  opponentName: string;
  isHome: boolean;
  goalsFor: number;
  goalsAgainst: number;
  result: 'W' | 'D' | 'L';
}

export interface TeamSnapshot {
  teamId: string;
  teamName: string;
  position: number | null;
  points: number | null;
  played: number | null;
  form: string[];
  recent: RecentMatch[];
}

export interface HeadToHeadMatch {
  id: string;
  date: string | null;
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
}

export interface MatchPreview {
  home: TeamSnapshot;
  away: TeamSnapshot;
  headToHead: HeadToHeadMatch[];
}

function snapshot(overview: SeasonOverview, teamId: string, fallbackName: string): TeamSnapshot {
  const row = overview.standings.find((s) => s.teamId === teamId);
  const recent = overview.matches
    .filter((m) => m.status === 'finished' && (m.homeTeam.id === teamId || m.awayTeam.id === teamId))
    .sort((a, b) => String(matchDate(b) ?? '').localeCompare(String(matchDate(a) ?? '')))
    .slice(0, 5)
    .map((m) => {
      const isHome = m.homeTeam.id === teamId;
      const goalsFor = (isHome ? m.score.home : m.score.away) ?? 0;
      const goalsAgainst = (isHome ? m.score.away : m.score.home) ?? 0;
      return {
        id: m.id,
        date: matchDate(m),
        opponentName: isHome ? m.awayTeam.name : m.homeTeam.name,
        isHome,
        goalsFor,
        goalsAgainst,
        result: goalsFor > goalsAgainst ? 'W' as const : goalsFor < goalsAgainst ? 'L' as const : 'D' as const,
      };
    });
  return {
    teamId,
    teamName: row?.teamName ?? fallbackName,
    position: row?.position ?? null,
    points: row?.points ?? null,
    played: row?.played ?? null,
    form: (row?.form ?? []).slice(-5),
    recent,
  };
}

function matchDate(m: SeasonMatch): string | null {
  return m.finishedAt ?? m.scheduledAt;
}

/**
 * Datos de la previa de un partido: posición, puntos, forma y enfrentamientos
 * anteriores entre los dos equipos DENTRO de la temporada cargada. Si no hay
 * clasificación ni H2H, el componente no pinta nada.
 */
export function buildMatchPreview(
  overview: SeasonOverview,
  input: { matchId: string; homeTeamId: string; awayTeamId: string; homeName: string; awayName: string },
): MatchPreview {
  const headToHead = overview.matches
    .filter((m) => m.id !== input.matchId && m.status === 'finished')
    .filter((m) =>
      (m.homeTeam.id === input.homeTeamId && m.awayTeam.id === input.awayTeamId) ||
      (m.homeTeam.id === input.awayTeamId && m.awayTeam.id === input.homeTeamId))
    .sort((a, b) => String(matchDate(b) ?? '').localeCompare(String(matchDate(a) ?? '')))
    .slice(0, 3)
    .map((m) => ({
      id: m.id,
      date: matchDate(m),
      homeName: m.homeTeam.name,
      awayName: m.awayTeam.name,
      homeScore: m.score.home,
      awayScore: m.score.away,
    }));

  return {
    home: snapshot(overview, input.homeTeamId, input.homeName),
    away: snapshot(overview, input.awayTeamId, input.awayName),
    headToHead,
  };
}

export interface CompetitionSummary {
  /** not_started: nadie ha jugado · in_progress · finished: sin partidos pendientes. */
  status: 'not_started' | 'in_progress' | 'finished';
  /** Jornada de liga más alta con partidos jugados, sobre el total de jornadas de liga. */
  matchday: { current: number; total: number } | null;
  leader: {
    teamId: string; teamName: string; points: number; played: number;
    /** Puntos de ventaja sobre el 2.º (null si no hay 2.º). */
    gap: number | null; secondTeamName: string | null;
  } | null;
  /** Partido de la próxima jornada entre los mejor clasificados. */
  featured: {
    id: string; date: string | null; timezone: string | null;
    homeTeamId: string; homeName: string; awayTeamId: string; awayName: string;
    homePosition: number | null; awayPosition: number | null;
    roundNumber: number | null; roundType: string;
  } | null;
  topScorer: {
    playerId: string | null; displayName: string; photoUrl: string | null;
    teamId: string | null; teamName: string | null; value: number;
    /** Goles de ventaja sobre el 2.º goleador. */
    gap: number | null;
  } | null;
  figures: { matchesPlayed: number; goalsPerMatch: number | null; homeWinPct: number | null } | null;
}

const PENDING = new Set(['scheduled', 'live', 'halftime', 'overtime', 'penalty_shootout']);

function leaderName(l: SeasonLeader): string {
  return l.firstName && l.lastName ? playerDisplayName(l.firstName, l.lastName) : playerNameFromRaw(l.playerName);
}

/**
 * Resumen de competición ("Así va la liga"): jornada, líder con su ventaja,
 * partido destacado de la próxima jornada, pichichi y cifras de la liga. Todo
 * sale de la clasificación, los partidos y los líderes de la temporada; un
 * bloque sin datos llega a null y el componente no lo pinta.
 */
export function buildCompetitionSummary(
  overview: SeasonOverview,
  stats: SeasonStats | null | undefined,
  now: Date = new Date(),
): CompetitionSummary {
  const finished = overview.matches.filter((m) => m.status === 'finished');
  const pending = overview.matches.filter((m) => PENDING.has(m.status));
  const status: CompetitionSummary['status'] =
    finished.length === 0 ? 'not_started' : pending.length === 0 ? 'finished' : 'in_progress';

  // Jornadas de liga: las rondas regulares de la temporada.
  const regularRounds = overview.rounds.filter((r) => r.roundType === 'regular');
  const totalRounds = regularRounds.length
    ? Math.max(...regularRounds.map((r) => r.number))
    : 0;
  const playedRounds = finished
    .filter((m) => m.roundType === 'regular' && m.roundNumber != null)
    .map((m) => m.roundNumber!);
  const matchday = totalRounds > 0 && playedRounds.length > 0
    ? { current: Math.min(Math.max(...playedRounds), totalRounds), total: totalRounds }
    : null;

  // Líder: solo con una tabla única (con grupos no hay un líder de la liga).
  const groups = new Set(overview.standings.map((s) => s.groupName ?? null));
  const sorted = [...overview.standings].sort((a, b) =>
    (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || b.points - a.points);
  const first = groups.size === 1 ? sorted.find((s) => s.played > 0) ?? null : null;
  const second = first ? sorted.find((s) => s !== first && s.played > 0) ?? null : null;

  const position = new Map(overview.standings.map((s) => [s.teamId, s.position]));
  const upcoming = overview.matches
    .filter((m) => m.status === 'scheduled' && m.scheduledAt && new Date(m.scheduledAt) >= now)
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
  // Candidatos: lo que se juega en la semana que empieza con el próximo partido.
  // Por ronda no vale: un aplazado de la jornada 2 jugado a mitad de semana
  // taparía la jornada 5 del fin de semana.
  const windowEnd = upcoming[0] ? new Date(upcoming[0].scheduledAt!).getTime() + 7 * 86_400_000 : 0;
  const nextRoundMatches = upcoming.filter((m) => new Date(m.scheduledAt!).getTime() <= windowEnd);
  // Más interesante = menor suma de posiciones (desempate: el que antes se juega).
  const rank = (m: SeasonMatch) => {
    const h = position.get(m.homeTeam.id), a = position.get(m.awayTeam.id);
    return h != null && a != null ? h + a : Number.MAX_SAFE_INTEGER;
  };
  const featuredMatch = status === 'finished' ? null
    : [...nextRoundMatches].sort((a, b) => rank(a) - rank(b))[0] ?? upcoming[0] ?? null;

  const [scorer1, scorer2] = stats?.topScorers ?? [];

  const scored = finished.filter((m) => m.score.home != null && m.score.away != null);
  const goals = scored.reduce((n, m) => n + m.score.home! + m.score.away!, 0);
  const homeWins = scored.filter((m) => m.score.home! > m.score.away!).length;

  return {
    status,
    matchday,
    leader: first
      ? {
          teamId: first.teamId, teamName: first.teamName, points: first.points, played: first.played,
          gap: second ? first.points - second.points : null, secondTeamName: second?.teamName ?? null,
        }
      : null,
    featured: featuredMatch
      ? {
          id: featuredMatch.id, date: featuredMatch.scheduledAt, timezone: featuredMatch.competitionTimezone ?? null,
          homeTeamId: featuredMatch.homeTeam.id, homeName: featuredMatch.homeTeam.name,
          awayTeamId: featuredMatch.awayTeam.id, awayName: featuredMatch.awayTeam.name,
          homePosition: position.get(featuredMatch.homeTeam.id) ?? null,
          awayPosition: position.get(featuredMatch.awayTeam.id) ?? null,
          roundNumber: featuredMatch.roundNumber, roundType: featuredMatch.roundType,
        }
      : null,
    topScorer: scorer1
      ? {
          playerId: scorer1.playerId, displayName: leaderName(scorer1), photoUrl: scorer1.photoUrl ?? null,
          teamId: scorer1.teamId, teamName: scorer1.teamName, value: scorer1.value,
          gap: scorer2 ? scorer1.value - scorer2.value : null,
        }
      : null,
    figures: scored.length > 0
      ? {
          matchesPlayed: scored.length,
          goalsPerMatch: Math.round((goals / scored.length) * 10) / 10,
          homeWinPct: Math.round((homeWins / scored.length) * 100),
        }
      : null,
  };
}
