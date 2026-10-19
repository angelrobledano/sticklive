import type { SeasonMatch, SeasonOverview, SeasonStats } from '@/lib/api/types';

/** Resumen server-rendered para fichas. Nada de textos si el dato es null. */

export interface TeamSnapshot {
  teamId: string;
  teamName: string;
  position: number | null;
  points: number | null;
  played: number | null;
  form: string[];
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
  return {
    teamId,
    teamName: row?.teamName ?? fallbackName,
    position: row?.position ?? null,
    points: row?.points ?? null,
    played: row?.played ?? null,
    form: (row?.form ?? []).slice(-5),
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
  played: number;
  leader: { teamId: string; teamName: string; points: number; position: number | null } | null;
  nextMatch: { id: string; homeName: string; awayName: string; date: string | null; round: string | null } | null;
  topScorer: { playerName: string; teamName: string | null; value: number } | null;
}

/**
 * Resumen de competición: líder, próximo partido y máximo goleador. Solo
 * devuelve bloques con datos; el componente omite los vacíos.
 */
export function buildCompetitionSummary(
  overview: SeasonOverview,
  stats: SeasonStats | null | undefined,
  now: Date = new Date(),
): CompetitionSummary {
  const played = overview.standings.filter((s) => s.played > 0);
  const sorted = [...overview.standings].sort((a, b) => {
    const pa = a.position ?? Number.MAX_SAFE_INTEGER;
    const pb = b.position ?? Number.MAX_SAFE_INTEGER;
    return pa - pb || b.points - a.points;
  });
  const leaderRow = sorted.find((s) => s.played > 0) ?? null;

  const next = overview.matches
    .filter((m) => m.status === 'scheduled' && m.scheduledAt && new Date(m.scheduledAt) >= now)
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)))[0] ?? null;

  const scorer = stats?.topScorers?.[0] ?? null;

  return {
    played: played.length,
    leader: leaderRow
      ? { teamId: leaderRow.teamId, teamName: leaderRow.teamName, points: leaderRow.points, position: leaderRow.position }
      : null,
    nextMatch: next
      ? {
          id: next.id,
          homeName: next.homeTeam.name,
          awayName: next.awayTeam.name,
          date: next.scheduledAt,
          round: next.roundName ?? (next.roundNumber ? `J${next.roundNumber}` : null),
        }
      : null,
    topScorer: scorer
      ? { playerName: scorer.playerName, teamName: scorer.teamName, value: scorer.value }
      : null,
  };
}
