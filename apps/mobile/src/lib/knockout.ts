import { gameWinnerId } from './playoff';
import { matchPhaseKey, playoffPhaseKey, type PlayoffPhaseKey } from '@sports/core/phase-keys';
import { STAGE_ORDER, type KnockoutStage } from '@sports/shared-types';

export interface KnockoutMatchInput {
  id: string;
  status: string;
  scheduledAt: string | null;
  finishedAt?: string | null;
  score: { home: number | null; away: number | null };
  homeTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
  awayTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
  roundId?: string | null;
  roundNumber?: number | null;
  roundName?: string | null;
  roundType?: string | null;
  stage?: string | null;
  winnerTeamId?: string | null;
  winType?: 'regular' | 'overtime' | 'penalties' | null;
}

export type KnockoutPhaseKey = PlayoffPhaseKey;

export { matchPhaseKey, playoffPhaseKey };

export interface KnockoutSeriesView {
  games: KnockoutMatchInput[];
  opponent: KnockoutMatchInput['homeTeam'];
  winsFor: number;
  winsAgainst: number;
  result: 'won' | 'lost' | 'open';
  decidedBy?: 'penalties' | 'overtime';
}

export interface KnockoutPhaseView {
  phase: KnockoutPhaseKey | null;
  roundName: string | null;
  roundNumber: number | null;
  series: KnockoutSeriesView[];
}

export interface KnockoutSummary {
  champion: boolean;
  incomplete: boolean;
  phases: KnockoutPhaseView[];
  eliminatedIn: KnockoutPhaseKey | null;
  phaseByMatch: Map<string, KnockoutPhaseView>;
  matches: KnockoutMatchInput[];
}

const KNOCKOUT_FORMATS = new Set(['bracket', 'final_four']);

export function isKnockoutFormat(format: string | null | undefined): boolean {
  return format != null && KNOCKOUT_FORMATS.has(format);
}

export function isKnockoutSeason(
  season: { competitionFormat?: string | null } | null | undefined,
  standing: unknown,
  matches: readonly KnockoutMatchInput[],
): boolean {
  if (isKnockoutFormat(season?.competitionFormat)) return true;
  return (
    standing == null &&
    matches.length > 0 &&
    matches.every((m) => m.roundType === 'playoff' || m.roundType === 'cup')
  );
}

export function knockoutPhaseLabel(
  p: { phase: KnockoutPhaseKey | null; roundName: string | null },
  t: (key: string) => string,
): string {
  if (p.phase) return t(`playoffs.${p.phase}`);
  return p.roundName || t('match_tabs.playoffs');
}

interface SeriesGroup {
  games: KnockoutMatchInput[];
  teamA: KnockoutMatchInput['homeTeam'];
  teamB: KnockoutMatchInput['homeTeam'];
  firstDate: number | null;
}

function matchDate(g: KnockoutMatchInput): number | null {
  const iso = g.scheduledAt ?? g.finishedAt ?? null;
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function groupByPair(matches: readonly KnockoutMatchInput[]): SeriesGroup[] {
  const map = new Map<string, KnockoutMatchInput[]>();
  for (const g of matches) {
    const key = [g.homeTeam.id, g.awayTeam.id].sort().join('|');
    const arr = map.get(key);
    if (arr) arr.push(g);
    else map.set(key, [g]);
  }
  return [...map.values()].map((games) => {
    games.sort((a, b) => (matchDate(a) ?? 0) - (matchDate(b) ?? 0));
    const ref = games[0]!;
    return {
      games,
      teamA: ref.homeTeam,
      teamB: ref.awayTeam,
      firstDate: games.map(matchDate).reduce<number | null>(
        (min, d) => (d != null && (min == null || d < min) ? d : min),
        null,
      ),
    };
  });
}

function involves(s: SeriesGroup, teamId: string): boolean {
  return s.teamA.id === teamId || s.teamB.id === teamId;
}

function seriesWinner(s: SeriesGroup): string | null {
  if (s.games.some((g) => g.status !== 'finished')) return null;
  let winsA = 0;
  let winsB = 0;
  for (const g of s.games) {
    const w = gameWinnerId(g);
    if (w === s.teamA.id) winsA++;
    else if (w === s.teamB.id) winsB++;
  }
  if (winsA === winsB) return null;
  return winsA > winsB ? s.teamA.id : s.teamB.id;
}

function hasExplicitStages(series: SeriesGroup[]): boolean {
  return (
    series.length > 0 &&
    series.every((s) => s.games.every((g) => matchPhaseKey({ stage: g.stage }) !== null))
  );
}

const PHASE_BY_RANK: (KnockoutPhaseKey | null)[] = ['final', 'semis', 'quarters', 'round_of_16'];

interface PhasedSeries {
  serie: SeriesGroup;
  phase: KnockoutPhaseKey | null;
  roundName: string | null;
  roundNumber: number | null;
}

function assignPhases(series: SeriesGroup[]): PhasedSeries[] {
  if (series.length === 0) return [];

  if (hasExplicitStages(series)) {
    const rank = (s: SeriesGroup) => STAGE_ORDER[s.games[0]!.stage as KnockoutStage] ?? 99;
    return [...series]
      .sort((a, b) => rank(a) - rank(b) || (a.firstDate ?? 0) - (b.firstDate ?? 0))
      .map((s) => ({
        serie: s,
        phase: matchPhaseKey(s.games[0]!),
        roundName: s.games[0]?.roundName ?? null,
        roundNumber: s.games[0]?.roundNumber ?? null,
      }));
  }

  const roundGroups = new Map<string, SeriesGroup[]>();
  for (const s of series) {
    const rid = s.games[0]?.roundId;
    if (!rid) continue;
    const arr = roundGroups.get(rid);
    if (arr) arr.push(s);
    else roundGroups.set(rid, [s]);
  }

  if (roundGroups.size >= 2) {
    const ladder: SeriesGroup[][] = [];
    const thirdPlace: SeriesGroup[] = [];
    for (const groups of roundGroups.values()) {
      const name = groups[0]!.games[0]?.roundName ?? null;
      if (playoffPhaseKey(name, null) === 'third_place') thirdPlace.push(...groups);
      else ladder.push(groups);
    }

    const out: PhasedSeries[] = [];
    ladder.sort((a, b) => {
      const na = a[0]!.games[0]?.roundNumber ?? null;
      const nb = b[0]!.games[0]?.roundNumber ?? null;
      if (na != null && nb != null && na !== nb) return na - nb;
      return (a[0]!.firstDate ?? 0) - (b[0]!.firstDate ?? 0);
    });
    ladder.forEach((groups, idx) => {
      const rank = ladder.length - 1 - idx;
      const phase = rank < PHASE_BY_RANK.length ? PHASE_BY_RANK[rank]! : null;
      for (const s of groups) {
        out.push({
          serie: s,
          phase,
          roundName: s.games[0]?.roundName ?? null,
          roundNumber: s.games[0]?.roundNumber ?? null,
        });
      }
    });
    for (const s of thirdPlace) {
      out.push({
        serie: s,
        phase: null,
        roundName: s.games[0]?.roundName ?? null,
        roundNumber: s.games[0]?.roundNumber ?? null,
      });
    }
    return out;
  }

  const dated = series.every((s) => s.firstDate != null);
  if (!dated) {
    return series.map((s) => ({
      serie: s,
      phase: null,
      roundName: s.games[0]?.roundName ?? null,
      roundNumber: s.games[0]?.roundNumber ?? null,
    }));
  }

  const ordered = [...series].sort((a, b) => (a.firstDate ?? 0) - (b.firstDate ?? 0));
  const n = ordered.length;
  const last = ordered[n - 1]!;
  const roundName = last.games[0]?.roundName ?? null;
  const roundNumber = last.games[0]?.roundNumber ?? null;
  const nameKey = playoffPhaseKey(roundName, null);

  if (n === 1) {
    return [{ serie: last, phase: nameKey ?? 'final', roundName, roundNumber }];
  }

  const earlier = ordered.slice(0, n - 1);
  const lastTeams = [last.teamA.id, last.teamB.id];
  const advanceChain = lastTeams.filter((id) =>
    earlier.some((s) => s.teamA.id === id || s.teamB.id === id),
  ).length;
  const winChain = lastTeams.filter((id) => earlier.some((s) => seriesWinner(s) === id)).length;

  if (advanceChain === 2) {
    return ordered.map((s, idx) => ({
      serie: s,
      phase: idx === n - 1 ? 'final' : idx >= n - 3 ? 'semis' : 'quarters',
      roundName,
      roundNumber,
    }));
  }

  if (winChain >= 1) {
    return ordered.map((s, idx) => ({
      serie: s,
      phase: idx === n - 1 ? 'final' : 'semis',
      roundName,
      roundNumber,
    }));
  }

  const fallback: KnockoutPhaseKey | null = nameKey === 'final' ? 'semis' : nameKey;
  return ordered.map((s) => ({ serie: s, phase: fallback, roundName, roundNumber }));
}

function bracketLadderConsistent(series: SeriesGroup[]): boolean {
  const ordered = [...series].sort((a, b) => (a.firstDate ?? 0) - (b.firstDate ?? 0));
  const n = ordered.length;
  if (n < 3) return true;
  for (let i = 0; i < n - 2; i++) {
    const s = ordered[i]!;
    if (playoffPhaseKey(s.games[0]?.roundName ?? null, null) === 'third_place') continue;
    const w = seriesWinner(s);
    if (!w) continue;
    const advances = ordered.slice(i + 1).some((q) => q.teamA.id === w || q.teamB.id === w);
    if (!advances) return false;
  }
  return true;
}

function seriesView(s: SeriesGroup, teamId: string): KnockoutSeriesView {
  const opponent = s.teamA.id === teamId ? s.teamB : s.teamA;
  let winsFor = 0;
  let winsAgainst = 0;
  let open = false;
  for (const g of s.games) {
    if (g.status !== 'finished') {
      open = true;
      continue;
    }
    const w = gameWinnerId(g);
    if (w === teamId) winsFor++;
    else if (w != null) winsAgainst++;
  }
  let result: KnockoutSeriesView['result'] = 'open';
  let decidedBy: KnockoutSeriesView['decidedBy'];
  if (!open) {
    if (winsFor > winsAgainst) result = 'won';
    else if (winsAgainst > winsFor) result = 'lost';
    else {
      const lastFinished = [...s.games].reverse().find((g) => g.status === 'finished');
      const w = lastFinished ? gameWinnerId(lastFinished) : null;
      if (w === teamId) result = 'won';
      else if (w != null) result = 'lost';
      const wt = lastFinished?.winType;
      if (wt === 'penalties' || wt === 'overtime') decidedBy = wt;
    }
  }
  if (!decidedBy && s.games.length === 1) {
    const wt = s.games[0]!.winType;
    if (wt === 'penalties' || wt === 'overtime') decidedBy = wt;
  }
  return { games: s.games, opponent, winsFor, winsAgainst, result, decidedBy };
}

export function buildKnockoutSummary(
  teamId: string,
  matches: readonly KnockoutMatchInput[],
): KnockoutSummary | null {
  if (matches.length === 0) return null;

  const mine = matches.filter((m) => m.homeTeam.id === teamId || m.awayTeam.id === teamId);
  if (mine.length === 0) return null;

  const allSeries = groupByPair(matches);
  const hasDates = allSeries.every((s) => s.firstDate != null);
  const hasRealRounds =
    new Set(allSeries.map((s) => s.games[0]?.roundId).filter((x): x is string => !!x)).size >= 2;
  const incomplete =
    !hasExplicitStages(allSeries) &&
    !hasRealRounds &&
    (!hasDates || !bracketLadderConsistent(allSeries));

  const phaseByMatch = new Map<string, KnockoutPhaseView>();
  const phases: KnockoutPhaseView[] = [];

  if (incomplete) {
    return { champion: false, incomplete, phases, eliminatedIn: null, phaseByMatch, matches: mine };
  }

  const phased = assignPhases(allSeries);
  const order: KnockoutPhaseView[] = [];
  const byKey = new Map<string, KnockoutPhaseView>();

  for (const { serie, phase, roundName, roundNumber } of phased) {
    if (!involves(serie, teamId)) continue;
    const key = `${phase ?? '?'}:${roundNumber ?? ''}`;
    let view = byKey.get(key);
    if (!view) {
      view = { phase, roundName, roundNumber, series: [] };
      byKey.set(key, view);
      order.push(view);
    }
    view.series.push(seriesView(serie, teamId));
    for (const g of serie.games) phaseByMatch.set(g.id, view);
  }

  const finalPhase = order.find((p) => p.phase === 'final');
  const champion = finalPhase?.series.every((s) => s.result === 'won') ?? false;

  let eliminatedIn: KnockoutPhaseKey | null = null;
  if (!champion) {
    for (let i = order.length - 1; i >= 0; i--) {
      if (order[i]!.series.some((s) => s.result === 'lost')) {
        eliminatedIn = order[i]!.phase;
        break;
      }
    }
  }

  return { champion, incomplete, phases: order, eliminatedIn, phaseByMatch, matches: mine };
}
