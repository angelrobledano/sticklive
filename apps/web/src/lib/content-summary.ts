import type { SeasonLeader, SeasonMatch, SeasonOverview, SeasonStats, TeamRecentMatch, TeamSeasonStats } from '@/lib/api/types';
import { gameWinnerId } from '@/lib/playoff';
import { playerDisplayName, playerNameFromRaw } from '@/lib/names';

/** Resumen server-rendered para fichas. Nada de textos si el dato es null. */

export interface RecentMatch {
  id: string;
  date: string | null;
  opponentId: string;
  opponentName: string;
  opponentLogoUrl: string | null;
  competitionName: string | null;
  isHome: boolean;
  goalsFor: number;
  goalsAgainst: number;
  result: 'W' | 'D' | 'L';
}

export type TeamObservationKind = 'win_streak' | 'unbeaten' | 'recent_goals' | 'home_wins' | 'away_wins' | 'goals_per_match';

export interface TeamObservation {
  kind: TeamObservationKind;
  value: number;
  total: number;
}

export type CrossMetricKey = 'goals_per_match' | 'minutes_goal' | 'minutes_conceded' | 'fouls' | 'direct_fouls' | 'direct_foul_pct' | 'penalty_pct' | 'cards';

export interface CrossMetric {
  key: CrossMetricKey;
  home: number | null;
  away: number | null;
  unit: 'minutes' | 'per_match' | 'pct';
}

export interface TeamSnapshot {
  teamId: string;
  teamName: string;
  position: number | null;
  points: number | null;
  played: number | null;
  form: string[];
  recent: RecentMatch[];
  observations: TeamObservation[];
}

export interface PreviewExtra {
  homeRecent?: TeamRecentMatch[];
  awayRecent?: TeamRecentMatch[];
  homeStats?: TeamSeasonStats | null;
  awayStats?: TeamSeasonStats | null;
}

export interface HeadToHeadMatch {
  id: string;
  date: string | null;
  /** Ids para escudos y para atribuir victorias (opcionales: payloads antiguos). */
  homeTeamId?: string;
  awayTeamId?: string;
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
}

export interface MatchPreview {
  home: TeamSnapshot;
  away: TeamSnapshot;
  headToHead: HeadToHeadMatch[];
  cross: CrossMetric[];
}

/** Último partido anterior entre los dos equipos, para enlazar fichas jugadas. */
export function buildPreviousMeeting(
  overview: SeasonOverview,
  input: { matchId: string; homeTeamId: string; awayTeamId: string; date: string | null },
): HeadToHeadMatch | null {
  const current = input.date ? new Date(input.date).getTime() : Date.now();
  const previous = overview.matches
    .filter((m) => m.id !== input.matchId && m.status === 'finished')
    .filter((m) =>
      (m.homeTeam.id === input.homeTeamId && m.awayTeam.id === input.awayTeamId)
      || (m.homeTeam.id === input.awayTeamId && m.awayTeam.id === input.homeTeamId))
    .filter((m) => {
      const date = matchDate(m);
      return !date || new Date(date).getTime() < current;
    })
    .sort((a, b) => String(matchDate(b) ?? '').localeCompare(String(matchDate(a) ?? '')))[0];
  if (!previous) return null;
  return {
    id: previous.id,
    date: matchDate(previous),
    homeName: previous.homeTeam.name,
    awayName: previous.awayTeam.name,
    homeScore: previous.score.home,
    awayScore: previous.score.away,
  };
}

function recentFromTeam(m: TeamRecentMatch, teamId: string): RecentMatch {
  const isHome = m.homeTeamId === teamId;
  const goalsFor = isHome ? m.homeScore : m.awayScore;
  const goalsAgainst = isHome ? m.awayScore : m.homeScore;
  return {
    id: m.id,
    date: m.date,
    opponentId: isHome ? m.awayTeamId : m.homeTeamId,
    opponentName: isHome ? m.awayName : m.homeName,
    opponentLogoUrl: isHome ? m.awayLogoUrl : m.homeLogoUrl,
    competitionName: m.competitionShortName ?? m.competitionName,
    isHome,
    goalsFor,
    goalsAgainst,
    result: goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D',
  };
}

function recentFromOverview(overview: SeasonOverview, teamId: string): RecentMatch[] {
  return overview.matches
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
        opponentId: isHome ? m.awayTeam.id : m.homeTeam.id,
        opponentName: isHome ? m.awayTeam.name : m.homeTeam.name,
        opponentLogoUrl: null,
        competitionName: m.roundType === 'regular' ? null : m.roundName,
        isHome,
        goalsFor,
        goalsAgainst,
        result: goalsFor > goalsAgainst ? 'W' as const : goalsFor < goalsAgainst ? 'L' as const : 'D' as const,
      };
    });
}

/** Observaciones de la previa: sólo hechos de los últimos 5 y de la temporada. */
export function buildTeamObservations(recent: RecentMatch[], stats: TeamSeasonStats | null | undefined): TeamObservation[] {
  const out: TeamObservation[] = [];
  if (recent.length === 0) return out;
  const goals = recent.reduce((n, r) => n + r.goalsFor, 0);
  if (goals >= 5) out.push({ kind: 'recent_goals', value: goals, total: recent.length });
  let streak = 0;
  for (const r of recent) {
    if (r.result !== 'W') break;
    streak++;
  }
  if (streak >= 3) out.push({ kind: 'win_streak', value: streak, total: recent.length });
  const unbeaten = recent.findIndex((r) => r.result === 'L');
  const unbeatenCount = unbeaten === -1 ? recent.length : unbeaten;
  if (unbeatenCount >= 3 && streak < 3) out.push({ kind: 'unbeaten', value: unbeatenCount, total: recent.length });
  const home = recent.filter((r) => r.isHome);
  const homeWins = home.filter((r) => r.result === 'W').length;
  if (home.length >= 2 && homeWins >= 2) out.push({ kind: 'home_wins', value: homeWins, total: home.length });
  const away = recent.filter((r) => !r.isHome);
  const awayWins = away.filter((r) => r.result === 'W').length;
  if (away.length >= 2 && awayWins >= 2) out.push({ kind: 'away_wins', value: awayWins, total: away.length });
  if (stats && stats.played >= 3 && stats.goalsFor > 0) {
    out.push({ kind: 'goals_per_match', value: Math.round((stats.goalsFor / stats.played) * 10) / 10, total: stats.played });
  }
  return out.slice(0, 4);
}

/** Números del cruce calculados con los totales de temporada de cada equipo. */
export function buildCrossMetrics(home: TeamSeasonStats | null | undefined, away: TeamSeasonStats | null | undefined): CrossMetric[] {
  if (!home || !away || home.played === 0 || away.played === 0) return [];
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const per = (n: number, played: number) => r1(n / played);
  const minutes = (goals: number, played: number) => goals > 0 ? Math.round(50 / (goals / played)) : null;
  const cards = (s: TeamSeasonStats) => s.blueCards + s.redCards;
  const metrics: CrossMetric[] = [
    { key: 'goals_per_match', home: per(home.goalsFor, home.played), away: per(away.goalsFor, away.played), unit: 'per_match' },
    { key: 'minutes_goal', home: minutes(home.goalsFor, home.played), away: minutes(away.goalsFor, away.played), unit: 'minutes' },
    { key: 'minutes_conceded', home: minutes(home.goalsAgainst, home.played), away: minutes(away.goalsAgainst, away.played), unit: 'minutes' },
    { key: 'fouls', home: per(home.teamFouls, home.played), away: per(away.teamFouls, away.played), unit: 'per_match' },
    { key: 'direct_fouls', home: per(home.directFouls.total, home.played), away: per(away.directFouls.total, away.played), unit: 'per_match' },
    { key: 'direct_foul_pct', home: home.directFouls.pct, away: away.directFouls.pct, unit: 'pct' },
    { key: 'penalty_pct', home: home.penalties.pct, away: away.penalties.pct, unit: 'pct' },
    { key: 'cards', home: per(cards(home), home.played), away: per(cards(away), away.played), unit: 'per_match' },
  ];
  return metrics.filter((m) => m.home !== null || m.away !== null);
}

function snapshot(
  overview: SeasonOverview,
  teamId: string,
  fallbackName: string,
  extra?: { recent?: TeamRecentMatch[]; stats?: TeamSeasonStats | null },
): TeamSnapshot {
  const row = overview.standings.find((s) => s.teamId === teamId);
  const recent = extra?.recent?.length
    ? extra.recent.slice(0, 5).map((m) => recentFromTeam(m, teamId))
    : recentFromOverview(overview, teamId);
  return {
    teamId,
    teamName: row?.teamName ?? fallbackName,
    position: row?.position ?? null,
    points: row?.points ?? null,
    played: row?.played ?? null,
    form: (row?.form ?? []).slice(-5),
    recent,
    observations: buildTeamObservations(recent, extra?.stats),
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
  extra?: PreviewExtra,
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
      homeTeamId: m.homeTeam.id,
      awayTeamId: m.awayTeam.id,
      homeName: m.homeTeam.name,
      awayName: m.awayTeam.name,
      homeScore: m.score.home,
      awayScore: m.score.away,
    }));

  return {
    home: snapshot(overview, input.homeTeamId, input.homeName, {
      recent: extra?.homeRecent?.filter((m) => m.id !== input.matchId),
      stats: extra?.homeStats,
    }),
    away: snapshot(overview, input.awayTeamId, input.awayName, {
      recent: extra?.awayRecent?.filter((m) => m.id !== input.matchId),
      stats: extra?.awayStats,
    }),
    headToHead,
    cross: buildCrossMetrics(extra?.homeStats, extra?.awayStats),
  };
}

export interface CompetitionSummary {
  /** not_started: nadie ha jugado · in_progress · finished: sin partidos pendientes. */
  status: 'not_started' | 'in_progress' | 'finished';
  /**
   * league: liga a jornadas con una tabla · tournament: final four, cuadro o
   * fase de grupos. Decide los títulos ("Así va la liga" / "Así va el torneo").
   */
  kind: 'league' | 'tournament';
  /** Jornada de liga más alta con partidos jugados, sobre el total de jornadas de liga. */
  matchday: { current: number; total: number } | null;
  /**
   * Medallero de una competición con final y 3.º/4.º puesto (Mundiales, Europeos,
   * copas con partido por el bronce). Null si no hay un podio completo.
   */
  podium: {
    gold: { teamId: string; teamName: string };
    silver: { teamId: string; teamName: string };
    bronze: { teamId: string; teamName: string };
  } | null;
  /**
   * Ganador de la final jugada en esta competición (copa, final four, cuadro o
   * liga con final). Null sin final terminada.
   */
  champion: {
    teamId: string; teamName: string; runnerUpId: string; runnerUpName: string; matchId: string;
  } | null;
  /**
   * 1.º de la tabla. Solo en ligas a jornadas: en un torneo (copa, final four,
   * cuadro, grupos) la tabla de puntos no decide nada y no se usa.
   */
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
    /** Nombre del 2.º goleador, para que la ventaja no se confunda con su equipo. */
    secondName: string | null;
  } | null;
  /** `homeWinPct` es null en torneos: se juegan en sede neutral. */
  figures: { matchesPlayed: number; goalsPerMatch: number | null; homeWinPct: number | null } | null;
}

const isFinalMatch = (m: SeasonMatch) =>
  m.stage === 'final' || (!m.stage && /^final$/i.test((m.roundName ?? '').trim()));

/** Campeón y subcampeón de la última final terminada. */
function buildChampion(matches: SeasonMatch[]): CompetitionSummary['champion'] {
  const final = lastFinished(matches.filter(isFinalMatch));
  const winner = final ? gameWinnerId(final) : null;
  if (!final || !winner) return null;
  const [w, r] = final.homeTeam.id === winner ? [final.homeTeam, final.awayTeam] : [final.awayTeam, final.homeTeam];
  if (w.id !== winner) return null;
  return { teamId: w.id, teamName: w.name, runnerUpId: r.id, runnerUpName: r.name, matchId: final.id };
}

const PENDING = new Set(['scheduled', 'live', 'halftime', 'overtime', 'penalty_shootout']);

function leaderName(l: SeasonLeader): string {
  return l.firstName && l.lastName ? playerDisplayName(l.firstName, l.lastName) : playerNameFromRaw(l.playerName);
}

/** Último partido terminado de un grupo (por fecha; el desempate es estable). */
function lastFinished(matches: SeasonMatch[]): SeasonMatch | null {
  const done = matches
    .filter((m) => m.status === 'finished')
    .sort((a, b) => String(a.scheduledAt ?? '').localeCompare(String(b.scheduledAt ?? '')));
  return done[done.length - 1] ?? null;
}

/**
 * Podio de una competición con final y partido por el 3.º puesto. Se apoya en
 * `stage` (fuente actual) y cae al nombre de ronda en temporadas heredadas.
 * Solo devuelve un medallero completo: sin bronce no hay tabla de medallas.
 */
function buildPodium(matches: SeasonMatch[]): CompetitionSummary['podium'] {
  const isFinal = isFinalMatch;
  const isThird = (m: SeasonMatch) =>
    m.stage === 'third_place' || (!m.stage && /3.*4|tercer|third|bronce/i.test(m.roundName ?? ''));

  const final = lastFinished(matches.filter(isFinal));
  const third = lastFinished(matches.filter(isThird));
  if (!final || !third) return null;

  const finalWinner = gameWinnerId(final);
  const thirdWinner = gameWinnerId(third);
  if (!finalWinner || !thirdWinner) return null;

  const byId = (m: SeasonMatch, id: string) => {
    if (m.homeTeam.id === id) return m.homeTeam;
    if (m.awayTeam.id === id) return m.awayTeam;
    return null;
  };
  const gold = byId(final, finalWinner);
  const silver = byId(final, final.homeTeam.id === finalWinner ? final.awayTeam.id : final.homeTeam.id);
  const bronze = byId(third, thirdWinner);
  if (!gold || !silver || !bronze) return null;

  return {
    gold: { teamId: gold.id, teamName: gold.name },
    silver: { teamId: silver.id, teamName: silver.name },
    bronze: { teamId: bronze.id, teamName: bronze.name },
  };
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

  const groups = new Set(overview.standings.map((s) => s.groupName ?? null));
  const format = (overview.season as { competitionFormat?: string }).competitionFormat;
  const kind: CompetitionSummary['kind'] =
    format === 'bracket' || format === 'final_four' || groups.size > 1 || regularRounds.length === 0 ? 'tournament' : 'league';

  // Líder y posiciones: solo en una liga a jornadas con tabla única. En una
  // copa (Supercopa a partido único) la API también calcula puntos con sus
  // resultados, pero esa tabla no decide nada: no se enseña.
  const table = kind === 'league' ? overview.standings : [];
  const sorted = [...table].sort((a, b) =>
    (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || b.points - a.points);
  const first = sorted.find((s) => s.played > 0) ?? null;
  const second = first ? sorted.find((s) => s !== first && s.played > 0) ?? null : null;

  const position = new Map(table.map((s) => [s.teamId, s.position]));
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
    kind,
    matchday,
    podium: buildPodium(overview.matches),
    champion: buildChampion(overview.matches),
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
          secondName: scorer2 ? leaderName(scorer2) : null,
        }
      : null,
    figures: scored.length > 0
      ? {
          matchesPlayed: scored.length,
          goalsPerMatch: Math.round((goals / scored.length) * 10) / 10,
          homeWinPct: kind === 'league' ? Math.round((homeWins / scored.length) * 100) : null,
        }
      : null,
  };
}
