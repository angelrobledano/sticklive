'use client';

import { useMemo, useCallback, Suspense, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n';
import type { SeasonOverview, CompetitionSeason, SeasonStats } from '@/lib/api/client';
import { CompetitionHeader } from './CompetitionHeader';
import { StandingsTab } from './StandingsTab';
import { GameweeksTab } from './GameweeksTab';
import { PlayoffsTab } from './PlayoffsTab';
import { StatsLeadersTab } from './StatsLeadersTab';
import { tt } from '@/components/search/translate';
import { roundLabel } from './format';
import { clubName } from '@/lib/names';

// ─── Componente principal ───

type MainTab = 'Clasificación' | 'Jornadas' | 'Playoffs' | 'Estadísticas';
// Etiquetas i18n (los valores internos siguen siendo estables en ES)
const MAIN_TAB_KEYS: Record<MainTab, string> = {
  'Clasificación': 'match_tabs.standing',
  'Jornadas':      'match_tabs.fixtures',
  'Playoffs':      'match_tabs.playoffs',
  'Estadísticas':  'match_tabs.stats',
};

/** #352: slugs estables del tab principal en la URL (?tab=). */
const TAB_SLUG: Record<MainTab, string> = {
  'Clasificación': 'standing', 'Jornadas': 'fixtures', 'Playoffs': 'playoffs', 'Estadísticas': 'stats',
};

/**
 * #352: tab principal que pide la URL, o `null` si el parámetro falta, no es un
 * slug válido o apunta a una pestaña no visible en esta competición. Función
 * pura, testeable sin navegador.
 */
export function competitionTabFromParam(param: string | null, visible: readonly MainTab[]): MainTab | null {
  if (!param) return null;
  const tab = (Object.keys(TAB_SLUG) as MainTab[]).find((k) => TAB_SLUG[k] === param);
  return tab && visible.includes(tab) ? tab : null;
}

export interface CompetitionIndexTeam {
  id: string;
  name: string;
}

/**
 * #339: equipos únicos de la competición (clasificación + partidos) para
 * enlazarlos en el HTML server-side. Antes los equipos solo eran enlazables via
 * la pestaña Clasificación (que no existe sin clasificación publicada). Función
 * pura, testeable sin navegador.
 */
export function competitionTeamsForIndex(
  data: Pick<SeasonOverview, 'standings' | 'matches'>,
): CompetitionIndexTeam[] {
  const map = new Map<string, string>();
  for (const s of data.standings) map.set(s.teamId, s.teamShortName ?? s.teamName);
  for (const m of data.matches) {
    if (m.homeTeam?.id) map.set(m.homeTeam.id, m.homeTeam.shortName ?? m.homeTeam.name);
    if (m.awayTeam?.id) map.set(m.awayTeam.id, m.awayTeam.shortName ?? m.awayTeam.name);
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * #358: navegación del patrón ARIA tabs (roving tabindex). Devuelve el índice
 * destino para flechas/Home/End, o el mismo si la tecla no aplica. Función pura.
 */
export function nextTabIndex(current: number, key: string, count: number): number {
  if (count <= 0) return -1;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown': return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':   return (current - 1 + count) % count;
    case 'Home':      return 0;
    case 'End':       return count - 1;
    default:          return current;
  }
}

export function CompetitionClient({ data, seasons, competitionId, stats }: {
  data: SeasonOverview;
  seasons?: CompetitionSeason[];
  competitionId?: string;
  stats?: SeasonStats | null;
}) {
  // Pestañas según los datos: una eliminatoria pura (playoff) no tiene
  // clasificación, y una liga sin fase final no necesita pestaña Playoffs.
  const visibleTabs = useMemo<MainTab[]>(() => {
    const tabs: MainTab[] = [];
    if (data.standings.length > 0) tabs.push('Clasificación');
    if (data.matches.some((m) => m.roundType === 'regular')) tabs.push('Jornadas');
    if (data.matches.some((m) => m.roundType === 'playoff')) tabs.push('Playoffs');
    if (stats && (stats.topScorers.length > 0 || stats.topAssists.length > 0 || stats.topCards.length > 0)) {
      tabs.push('Estadísticas');
    }
    return tabs.length > 0 ? tabs : ['Clasificación'];
  }, [data.standings, data.matches, stats]);

  const { t } = useT();
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  // #352: el tab principal vive en la URL (`?tab=`) sin pisar los sub-filtros
  // (?season/?journey/?date/?team_id/?phase): GameweeksTab y PlayoffsTab
  // construyen sus params sobre `sp` y los preservan. Un slug inválido o de una
  // pestaña no visible en esta competición cae a la primera con contenido.
  const requestedTab = competitionTabFromParam(sp.get('tab'), visibleTabs);
  const currentTab: MainTab = requestedTab ?? visibleTabs[0]!;

  const selectTab = useCallback((tab: MainTab) => {
    const params = new URLSearchParams(sp.toString());
    params.set('tab', TAB_SLUG[tab]);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }, [sp, pathname, router]);

  // #339: índice enlazado server-side. Los equipos/partidos solo existían en
  // pestañas cliente; este índice viaja en el HTML inicial para el crawler.
  const teamsIndex = useMemo(
    () => competitionTeamsForIndex(data),
    [data],
  );
  const compId = competitionId ?? data.season.competitionId;
  const seasonParam = sp.get('season');
  const fixturesHref = (journey: number) =>
    `/competitions/${compId}?tab=fixtures&journey=${journey}` +
    (seasonParam ? `&season=${encodeURIComponent(seasonParam)}` : '');

  // #358: patrón ARIA tabs con roving tabindex y navegación por flechas.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const i = visibleTabs.indexOf(currentTab);
    const next = nextTabIndex(i, e.key, visibleTabs.length);
    if (next < 0 || next === i) return;
    e.preventDefault();
    selectTab(visibleTabs[next]!);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="space-y-4">
      <CompetitionHeader data={data} seasons={seasons} competitionId={competitionId} />

      {/* Pestañas principales (#358: patrón ARIA tabs) */}
      <div role="tablist"
           aria-label={tt(t, 'a11y.competition_tabs', 'Secciones de la competición')}
           onKeyDown={onTabKeyDown}
           className="flex gap-0 border-b border-slate-200 dark:border-slate-800 overflow-x-auto scrollbar-none"
           style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {visibleTabs.map((tab, i) => (
          <button
            key={tab}
            ref={(el) => { tabRefs.current[i] = el; }}
            role="tab"
            id={`competition-tab-${i}`}
            aria-selected={currentTab === tab}
            aria-controls={`competition-panel-${i}`}
            tabIndex={currentTab === tab ? 0 : -1}
            onClick={() => selectTab(tab)}
            className={`px-4 py-2.5 text-sm border-b -mb-px transition-colors whitespace-nowrap shrink-0 ${
              currentTab === tab
                ? 'border-rink-passion text-rink-passion font-semibold active:bg-rink-passion/5'
                : 'border-transparent font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 active:bg-slate-50 dark:active:bg-slate-800/60 active:text-slate-900 dark:active:text-slate-100'
            }`}
          >
            {t(MAIN_TAB_KEYS[tab])}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`competition-panel-${visibleTabs.indexOf(currentTab)}`}
        aria-labelledby={`competition-tab-${visibleTabs.indexOf(currentTab)}`}
      >
      {currentTab === 'Clasificación' && <StandingsTab standings={data.standings} />}
      {currentTab === 'Jornadas'      && (
        <Suspense fallback={<div className="card h-40 animate-pulse" aria-hidden="true" />}>
          <GameweeksTab rounds={data.rounds} matches={data.matches} />
        </Suspense>
      )}
      {currentTab === 'Playoffs'      && (
        <Suspense fallback={<div className="card h-40 animate-pulse" aria-hidden="true" />}>
          <PlayoffsTab matches={data.matches} />
        </Suspense>
      )}
      {currentTab === 'Estadísticas'  && stats && <StatsLeadersTab stats={stats} />}
      </div>

      {/* #339: grafo de enlaces HTML. Jornadas, partidos y equipos solo eran
          descubribles dentro de pestañas cliente; este índice (plegado, no
          oculto) los enlaza server-side para que el crawler los encuentre. */}
      {(teamsIndex.length > 0 || data.matches.length > 0) && (
        <details className="card px-4 py-3">
          <summary className="cursor-pointer select-none text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {tt(t, 'competition.index_title', 'Equipos y partidos')}
          </summary>

          {teamsIndex.length > 0 && (
            <section className="pt-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 pb-1">
                {tt(t, 'competition.index_teams', 'Equipos')}
              </p>
              <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
                {teamsIndex.map((tm) => (
                  <li key={tm.id}>
                    <Link
                      href={`/teams/${tm.id}`}
                      className="text-[12px] text-slate-600 dark:text-slate-300 hover:text-rink-passion dark:hover:text-red-400 hover:underline"
                    >
                      {clubName(tm.name)}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.rounds.length > 0 && (
            <section className="pt-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 pb-1">
                {tt(t, 'competition.index_rounds', 'Jornadas')}
              </p>
              <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
                {data.rounds.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={fixturesHref(r.number)}
                      className="text-[12px] text-slate-600 dark:text-slate-300 hover:text-rink-passion dark:hover:text-red-400 hover:underline"
                    >
                      {roundLabel(r, t)}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.matches.length > 0 && (
            <section className="pt-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 pb-1">
                {tt(t, 'competition.index_matches', 'Partidos')}
              </p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                {data.matches.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/matches/${m.id}`}
                      className="block truncate text-[12px] text-slate-600 dark:text-slate-300 hover:text-rink-passion dark:hover:text-red-400 hover:underline"
                    >
                      {m.homeTeam.shortName ?? m.homeTeam.name} – {m.awayTeam.shortName ?? m.awayTeam.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </details>
      )}
    </div>
  );
}
