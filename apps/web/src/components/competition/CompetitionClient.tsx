'use client';

import { useState, useMemo, Suspense } from 'react';
import { useT } from '@/lib/i18n';
import type { SeasonOverview, CompetitionSeason, SeasonStats } from '@/lib/api/client';
import { CompetitionHeader } from './CompetitionHeader';
import { StandingsTab } from './StandingsTab';
import { GameweeksTab } from './GameweeksTab';
import { PlayoffsTab } from './PlayoffsTab';
import { StatsLeadersTab } from './StatsLeadersTab';

// ─── Componente principal ───

type MainTab = 'Clasificación' | 'Jornadas' | 'Playoffs' | 'Estadísticas';
// Etiquetas i18n (los valores internos siguen siendo estables en ES)
const MAIN_TAB_KEYS: Record<MainTab, string> = {
  'Clasificación': 'match_tabs.standing',
  'Jornadas':      'match_tabs.fixtures',
  'Playoffs':      'match_tabs.playoffs',
  'Estadísticas':  'match_tabs.stats',
};

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

  const [activeTab, setActiveTab] = useState<MainTab>(visibleTabs[0]!);
  const currentTab = visibleTabs.includes(activeTab) ? activeTab : visibleTabs[0]!;
  const { t } = useT();

  return (
    <div className="space-y-4">
      <CompetitionHeader data={data} seasons={seasons} competitionId={competitionId} />

      {/* Pestañas principales */}
      <div className="flex gap-0 border-b border-slate-200 dark:border-slate-800">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm border-b -mb-px transition-colors whitespace-nowrap ${
              currentTab === tab
                ? 'border-rink-passion text-rink-passion font-semibold'
                : 'border-transparent font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t(MAIN_TAB_KEYS[tab])}
          </button>
        ))}
      </div>

      {currentTab === 'Clasificación' && <StandingsTab standings={data.standings} />}
      {currentTab === 'Jornadas'      && (
        <Suspense fallback={<div className="card h-40 animate-pulse" />}>
          <GameweeksTab rounds={data.rounds} matches={data.matches} />
        </Suspense>
      )}
      {currentTab === 'Playoffs'      && (
        <Suspense fallback={<div className="card h-40 animate-pulse" />}>
          <PlayoffsTab matches={data.matches} />
        </Suspense>
      )}
      {currentTab === 'Estadísticas'  && stats && <StatsLeadersTab stats={stats} />}
    </div>
  );
}
