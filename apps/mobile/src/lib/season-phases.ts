import type {
  KnockoutStage,
  SeasonOverview,
  SeasonMatch,
  SeasonPhase,
  SeasonStats,
} from '@/src/lib/api/types';

export type KnockoutLayout = 'series' | 'final_four' | 'bracket';

export interface KnockoutPhaseView {
  phase: SeasonPhase;
  matches: SeasonMatch[];
  rounds: SeasonOverview['rounds'];
  layout: KnockoutLayout;
}

const FINAL_FOUR_STAGES = new Set<KnockoutStage>(['semis', 'final', 'third_place']);

export function knockoutLayout(phase: SeasonPhase, matches: SeasonMatch[]): KnockoutLayout {
  if (matches.some((m) => (m.seriesGame ?? 0) >= 3)) return 'series';
  const stages = phase.stages.filter((s) => s !== 'placement');
  if (stages.includes('semis') && stages.every((s) => FINAL_FOUR_STAGES.has(s))) return 'final_four';
  return 'bracket';
}

export function knockoutPhaseViews(
  phases: SeasonPhase[] | undefined,
  rounds: SeasonOverview['rounds'],
  matches: SeasonMatch[],
): KnockoutPhaseView[] | null {
  if (!phases || phases.length === 0) return null;
  const knockout = phases.filter((p) => p.kind === 'knockout');
  if (knockout.some((p) => p.fromSource === false)) return null;

  const views: KnockoutPhaseView[] = [];
  for (const phase of knockout) {
    const own = matches.filter((m) => m.phaseId === phase.id);
    const ownRounds = rounds.filter((r) => r.phaseId === phase.id);
    if (phase.isPlacement) {
      views.push({ phase, matches: own, rounds: ownRounds, layout: 'bracket' });
      continue;
    }
    const isPl = (s: string | null | undefined) => s === 'placement';
    views.push({
      phase: { ...phase, stages: phase.stages.filter((s) => !isPl(s)) },
      matches: own.filter((m) => !isPl(m.stage)),
      rounds: ownRounds.filter((r) => !isPl(r.stage)),
      layout: 'bracket',
    });
    const plMatches = own.filter((m) => isPl(m.stage));
    if (plMatches.length > 0) {
      views.push({
        phase: { ...phase, id: `${phase.id}:colocacion`, isPlacement: true, name: null, stages: ['placement'] },
        matches: plMatches,
        rounds: ownRounds.filter((r) => isPl(r.stage)),
        layout: 'bracket',
      });
    }
  }
  views.sort((a, b) => Number(a.phase.isPlacement) - Number(b.phase.isPlacement) || a.phase.ordinal - b.phase.ordinal);
  const titleLayout = views.find((v) => !v.phase.isPlacement);
  for (const v of views) {
    if (!v.phase.isPlacement) v.layout = knockoutLayout(v.phase, v.matches);
  }
  for (const v of views) {
    if (v.phase.isPlacement) v.layout = titleLayout?.layout === 'series' ? 'series' : 'bracket';
  }
  return views;
}

/**
 * ¿La fase final ya manda en la competición?
 * Sí cuando hay partidos eliminatorios y, o bien alguno ya se ha jugado o se está jugando,
 * o bien la liga/fase de grupos está cerrada (todo terminado o cancelado).
 */
export function finalPhaseStarted(matches: Pick<SeasonMatch, 'roundType' | 'status'>[]): boolean {
  const knockout = matches.filter((m) => m.roundType === 'playoff');
  if (knockout.length === 0) return false;
  if (knockout.some((m) => m.status === 'live' || m.status === 'finished')) return true;
  return matches
    .filter((m) => m.roundType !== 'playoff')
    .every((m) => m.status === 'finished' || m.status === 'cancelled');
}

/**
 * Clave i18n del nombre de la pestaña del cuadro.
 */
export function knockoutTabLabelKey(
  format: string | null | undefined,
  phases: SeasonPhase[] | undefined,
  rounds: SeasonOverview['rounds'],
  matches: SeasonMatch[],
): string {
  if (format === 'final_four') return 'playoffs.final_four';
  const views = knockoutPhaseViews(phases, rounds, matches);
  const title = views?.find((v) => !v.phase.isPlacement);
  if (!title) return 'match_tabs.playoffs';
  if (title.layout === 'series') return 'match_tabs.playoffs';
  if (title.layout === 'final_four') return 'playoffs.final_four';
  return 'match_tabs.knockout';
}

export type MainTab = 'Clasificación' | 'Jornadas' | 'Playoffs' | 'Estadísticas';

export const MAIN_TAB_KEYS: Record<MainTab, string> = {
  'Clasificación': 'match_tabs.standing',
  'Jornadas': 'match_tabs.fixtures',
  'Playoffs': 'match_tabs.playoffs',
  'Estadísticas': 'match_tabs.stats',
};

export function competitionVisibleTabs(
  data: Pick<SeasonOverview, 'standings' | 'matches' | 'rounds'>,
  stats: SeasonStats | null | undefined,
  format: SeasonOverview['season']['competitionFormat'],
): MainTab[] {
  const isFinalFour = format === 'final_four';
  const tabs: MainTab[] = [];
  if (!isFinalFour && data.standings.length > 0) tabs.push('Clasificación');
  if (!isFinalFour && data.matches.some((m) => m.roundType === 'regular')) tabs.push('Jornadas');
  if (
    isFinalFour ||
    data.matches.some((m) => m.roundType === 'playoff') ||
    data.rounds.some((r) => r.roundType === 'playoff')
  ) {
    tabs.push('Playoffs');
  }
  if (
    stats &&
    ((stats.topScorers?.length ?? 0) > 0 ||
      (stats.topAssists?.length ?? 0) > 0 ||
      (stats.topCards?.length ?? 0) > 0)
  ) {
    tabs.push('Estadísticas');
  }

  // Si la fase final ya manda o la liga terminó con playoff, Playoffs va primero
  if (tabs.length > 1 && tabs.includes('Playoffs') && finalPhaseStarted(data.matches)) {
    return ['Playoffs', ...tabs.filter((t) => t !== 'Playoffs')];
  }
  return tabs.length > 0 ? tabs : ['Clasificación'];
}

export interface CompetitionIndexTeam {
  id: string;
  name: string;
}

/**
 * Equipos únicos de la competición para enlazarlos en la vista.
 */
export function competitionTeamsForIndex(
  data: Pick<SeasonOverview, 'standings' | 'matches'>,
): CompetitionIndexTeam[] {
  const map = new Map<string, string>();
  for (const s of data.standings) map.set(s.teamId, s.teamName);
  for (const m of data.matches) {
    if (m.homeTeam?.id && !map.has(m.homeTeam.id)) map.set(m.homeTeam.id, m.homeTeam.name);
    if (m.awayTeam?.id && !map.has(m.awayTeam.id)) map.set(m.awayTeam.id, m.awayTeam.name);
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
