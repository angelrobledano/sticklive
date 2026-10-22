import type {
  SeasonLeader,
  SeasonOverview,
  SeasonOverviewMatch,
  SeasonStats,
} from '@/src/lib/api/types';
import { gameWinnerId } from '@/src/lib/playoff';
import { playerDisplayName, playerNameFromRaw } from '@/src/lib/names';

export interface CompetitionSummaryData {
  status: 'not_started' | 'in_progress' | 'finished';
  matchday: { current: number; total: number } | null;
  podium: {
    gold: { teamId: string; teamName: string };
    silver: { teamId: string; teamName: string };
    bronze: { teamId: string; teamName: string };
  } | null;
  leader: {
    teamId: string;
    teamName: string;
    points: number;
    played: number;
    gap: number | null;
    secondTeamName: string | null;
  } | null;
  featured: {
    id: string;
    date: string | null;
    timezone: string | null;
    homeTeamId: string;
    homeName: string;
    awayTeamId: string;
    awayName: string;
    homePosition: number | null;
    awayPosition: number | null;
    roundNumber: number | null;
    roundType: string | null;
  } | null;
  topScorer: {
    playerId: string | null;
    displayName: string;
    photoUrl: string | null;
    teamId: string | null;
    teamName: string | null;
    value: number;
    gap: number | null;
    secondName: string | null;
  } | null;
  figures: {
    matchesPlayed: number;
    goalsPerMatch: number | null;
    homeWinPct: number | null;
  } | null;
}

const PENDING = new Set(['scheduled', 'live', 'halftime', 'overtime', 'penalty_shootout']);

function leaderName(l: SeasonLeader): string {
  return l.firstName && l.lastName
    ? playerDisplayName(l.firstName, l.lastName)
    : playerNameFromRaw(l.playerName);
}

function lastFinished(matches: SeasonOverviewMatch[]): SeasonOverviewMatch | null {
  const done = matches
    .filter((m) => m.status === 'finished')
    .sort((a, b) => String(a.scheduledAt ?? '').localeCompare(String(b.scheduledAt ?? '')));
  return done[done.length - 1] ?? null;
}

function buildPodium(matches: SeasonOverviewMatch[]): CompetitionSummaryData['podium'] {
  const isFinal = (m: SeasonOverviewMatch) =>
    m.stage === 'final' || (!m.stage && /^final$/i.test((m.roundName ?? '').trim()));
  const isThird = (m: SeasonOverviewMatch) =>
    m.stage === 'third_place' || (!m.stage && /3.*4|tercer|third|bronce/i.test(m.roundName ?? ''));

  const final = lastFinished(matches.filter(isFinal));
  const third = lastFinished(matches.filter(isThird));
  if (!final || !third) return null;

  const finalWinner = gameWinnerId(final);
  const thirdWinner = gameWinnerId(third);
  if (!finalWinner || !thirdWinner) return null;

  const byId = (m: SeasonOverviewMatch, id: string) => {
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

export function buildCompetitionSummary(
  overview: SeasonOverview,
  stats: SeasonStats | null | undefined,
  now: Date = new Date(),
): CompetitionSummaryData {
  const finished = overview.matches.filter((m) => m.status === 'finished');
  const pending = overview.matches.filter((m) => PENDING.has(m.status));
  const status: CompetitionSummaryData['status'] =
    finished.length === 0 ? 'not_started' : pending.length === 0 ? 'finished' : 'in_progress';

  const regularRounds = overview.rounds.filter((r) => r.roundType === 'regular');
  const totalRounds = regularRounds.length
    ? Math.max(...regularRounds.map((r) => r.number))
    : 0;
  const playedRounds = finished
    .filter((m) => m.roundType === 'regular' && m.roundNumber != null)
    .map((m) => m.roundNumber!);
  const matchday =
    totalRounds > 0 && playedRounds.length > 0
      ? { current: Math.min(Math.max(...playedRounds), totalRounds), total: totalRounds }
      : null;

  // Líder: solo con una tabla única (con grupos no hay un líder de la liga).
  const groups = new Set(overview.standings.map((s) => s.groupName ?? null));
  const sorted = [...overview.standings].sort(
    (a, b) =>
      (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
      b.points - a.points,
  );
  const first = groups.size <= 1 ? sorted.find((s) => s.played > 0) ?? null : null;
  const second = first ? sorted.find((s) => s !== first && s.played > 0) ?? null : null;

  const position = new Map(overview.standings.map((s) => [s.teamId, s.position]));
  const upcoming = overview.matches
    .filter((m) => m.status === 'scheduled' && m.scheduledAt && new Date(m.scheduledAt) >= now)
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
  const windowEnd = upcoming[0] ? new Date(upcoming[0].scheduledAt!).getTime() + 7 * 86_400_000 : 0;
  const nextRoundMatches = upcoming.filter((m) => new Date(m.scheduledAt!).getTime() <= windowEnd);
  const rank = (m: SeasonOverviewMatch) => {
    const h = position.get(m.homeTeam.id);
    const a = position.get(m.awayTeam.id);
    return h != null && a != null ? h + a : Number.MAX_SAFE_INTEGER;
  };
  const featuredMatch =
    status === 'finished'
      ? null
      : [...nextRoundMatches].sort((a, b) => rank(a) - rank(b))[0] ?? upcoming[0] ?? null;

  const [scorer1, scorer2] = stats?.topScorers ?? [];

  const scored = finished.filter((m) => m.score.home != null && m.score.away != null);
  const goals = scored.reduce((n, m) => n + m.score.home! + m.score.away!, 0);
  const homeWins = scored.filter((m) => m.score.home! > m.score.away!).length;

  return {
    status,
    matchday,
    podium: buildPodium(overview.matches),
    leader: first
      ? {
          teamId: first.teamId,
          teamName: first.teamName,
          points: first.points,
          played: first.played,
          gap: second ? first.points - second.points : null,
          secondTeamName: second?.teamName ?? null,
        }
      : null,
    featured: featuredMatch
      ? {
          id: featuredMatch.id,
          date: featuredMatch.scheduledAt,
          timezone: featuredMatch.competitionTimezone ?? null,
          homeTeamId: featuredMatch.homeTeam.id,
          homeName: featuredMatch.homeTeam.name,
          awayTeamId: featuredMatch.awayTeam.id,
          awayName: featuredMatch.awayTeam.name,
          homePosition: position.get(featuredMatch.homeTeam.id) ?? null,
          awayPosition: position.get(featuredMatch.awayTeam.id) ?? null,
          roundNumber: featuredMatch.roundNumber,
          roundType: featuredMatch.roundType,
        }
      : null,
    topScorer: scorer1
      ? {
          playerId: scorer1.playerId,
          displayName: leaderName(scorer1),
          photoUrl: scorer1.photoUrl ?? null,
          teamId: scorer1.teamId,
          teamName: scorer1.teamName,
          value: scorer1.value,
          gap: scorer2 ? scorer1.value - scorer2.value : null,
          secondName: scorer2 ? leaderName(scorer2) : null,
        }
      : null,
    figures:
      scored.length > 0
        ? {
            matchesPlayed: scored.length,
            goalsPerMatch: Math.round((goals / scored.length) * 10) / 10,
            homeWinPct: Math.round((homeWins / scored.length) * 100),
          }
        : null,
  };
}
