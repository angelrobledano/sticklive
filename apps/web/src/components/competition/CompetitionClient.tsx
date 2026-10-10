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
import { TeamShield } from '@/components/shared/TeamShield';
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
 * enlazarlos en el HTML server-side. Devuelve el NOMBRE COMPLETO — es el texto
 * ancla del enlace y da mejor SEO que las siglas. Función pura, testeable.
 */
export function competitionTeamsForIndex(
  data: Pick<SeasonOverview, 'standings' | 'matches'>,
): CompetitionIndexTeam[] {
  const map = new Map<string, string>();
  // La clasificación tiene prioridad; los partidos rellenan los equipos que no
  // aparezcan en ella (una eliminatoria puede no tener clasificación).
  for (const s of data.standings) map.set(s.teamId, s.teamName);
  for (const m of data.matches) {
    if (m.homeTeam?.id && !map.has(m.homeTeam.id)) map.set(m.homeTeam.id, m.homeTeam.name);
    if (m.awayTeam?.id && !map.has(m.awayTeam.id)) map.set(m.awayTeam.id, m.awayTeam.name);
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

export function competitionVisibleTabs(
  data: Pick<SeasonOverview, 'standings' | 'matches' | 'rounds'>,
  stats: SeasonStats | null | undefined,
  format: SeasonOverview['season']['competitionFormat'],
): MainTab[] {
  // Una Final Four (Supercopa) es un cuadro: sin Clasificación ni Jornadas.
  const isFinalFour = format === 'final_four';
  const tabs: MainTab[] = [];
  if (!isFinalFour && data.standings.length > 0) tabs.push('Clasificación');
  if (!isFinalFour && data.matches.some((m) => m.roundType === 'regular')) tabs.push('Jornadas');
  // La pestaña Playoffs aparece si hay partidos de playoff O si la competición
  // declara rondas eliminatorias aún sin partidos (WSG: los cruces de la fase
  // final se publican al cerrar los grupos — la estructura ya es visible).
  if (isFinalFour
    || data.matches.some((m) => m.roundType === 'playoff')
    || data.rounds.some((r) => r.roundType === 'playoff')) {
    tabs.push('Playoffs');
  }
  if (stats && (stats.topScorers.length > 0 || stats.topAssists.length > 0 || stats.topCards.length > 0)) {
    tabs.push('Estadísticas');
  }
  return tabs.length > 0 ? tabs : ['Clasificación'];
}

export function CompetitionClient({ data, seasons, competitionId, stats }: {
  data: SeasonOverview;
  seasons?: CompetitionSeason[];
  competitionId?: string;
  stats?: SeasonStats | null;
}) {
  // Pestañas según los datos: una eliminatoria pura (playoff) no tiene
  // clasificación, y una liga sin fase final no necesita pestaña Playoffs.
  // Una Final Four (Supercopa) es un cuadro: sin Clasificación ni Jornadas.
  const isFinalFour = data.season.competitionFormat === 'final_four';
  const visibleTabs = useMemo<MainTab[]>(
    () => competitionVisibleTabs(data, stats, data.season.competitionFormat),
    [data, stats],
  );

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

  // #339: índice enlazado server-side para el crawler (las pestañas son cliente).
  const teamsIndex = useMemo(
    () => competitionTeamsForIndex(data),
    [data],
  );

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
            {isFinalFour && tab === 'Playoffs' ? t('playoffs.final_four') : t(MAIN_TAB_KEYS[tab])}
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
          <PlayoffsTab
            rounds={data.rounds}
            matches={data.matches}
            format={data.season.competitionFormat}
            phases={data.season.phases}
          />
        </Suspense>
      )}
      {currentTab === 'Estadísticas'  && stats && <StatsLeadersTab stats={stats} />}
      </div>

      {/* #339: índice enlazado server-side (las pestañas son cliente). Diseño
          curado: equipos VISIBLES como chips (escudo + nombre completo, buen
          texto ancla) y los partidos en un nav `sr-only`. El sitemap ya lista
          los partidos; volcar 180 enlaces visibles diluiría el enlace. Fuera
          las "Jornadas": son la MISMA URL con `?journey=`, no páginas nuevas. */}
      {teamsIndex.length > 0 && (
        <nav aria-label={tt(t, 'competition.index_teams', 'Equipos')} className="card p-4 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {tt(t, 'competition.index_teams', 'Equipos')}
          </h2>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {teamsIndex.map((tm) => (
              <li key={tm.id}>
                <Link
                  href={`/teams/${tm.id}`}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-2.5 py-2 min-h-[44px]
                             hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <TeamShield teamId={tm.id} teamName={tm.name} size={24} />
                  <span className="min-w-0 truncate text-[13px] font-medium text-slate-700 dark:text-slate-200">
                    {clubName(tm.name)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* Partidos para el crawler: ruta server-side a TODOS (incluidos los
          históricos fuera de la ventana del sitemap), sin coste visual. */}
      {data.matches.length > 0 && (
        <nav className="sr-only" aria-hidden="true">
          <ul>
            {data.matches.map((m) => (
              <li key={m.id}>
                <Link href={`/matches/${m.id}`} tabIndex={-1}>
                  {m.homeTeam.name} – {m.awayTeam.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
