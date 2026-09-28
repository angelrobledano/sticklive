'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { SeasonMatch } from '@/lib/api/client';
import {
  PLAYOFF_PHASES,
  type PlayoffPhase,
  type PlayoffSeries,
  buildSeries,
  groupByPhase,
  advancedFrom,
} from '@/lib/playoff';
import { useT } from '@/lib/i18n';

/**
 * Bracket compacto de eliminación directa para la ficha de partido.
 * Columnas horizontales deslizables (Cuartos → Semis → Final), con la
 * eliminatoria del partido actual resaltada y centrada al cargar.
 * Colapsable para no robar espacio una vez el usuario se ha contextualizado.
 */

function MicroSeries({ serie, isCurrent, advanced, linkable }: {
  serie: PlayoffSeries;
  isCurrent: boolean;
  advanced: Set<string>;
  linkable: boolean;
}) {
  // Eliminatoria a partido único: en vez del marcador de victorias (1–0, que
  // parece el resultado del partido y confunde) mostramos el marcador real.
  const single = serie.games.length === 1 ? serie.games[0]! : null;
  const singleScored = !!single && (single.status === 'finished' || single.status === 'live');
  const rows = [
    { team: serie.teamA, wins: serie.winsA, score: single?.score.home ?? null },
    { team: serie.teamB, wins: serie.winsB, score: single?.score.away ?? null },
  ];
  // Partido enlazable: el último jugado o el próximo
  const target = serie.games.find((g) => g.status === 'live')
    ?? [...serie.games].reverse().find((g) => g.status === 'finished')
    ?? serie.games[0];

  const content = (
    <div
      data-current={isCurrent}
      className={`w-[120px] shrink-0 rounded-lg border text-left transition-colors ${
        isCurrent
          ? 'border-rink-passion ring-1 ring-rink-passion/30 bg-rink-passion/[0.04]'
          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-600'
      }`}
    >
      {rows.map(({ team, wins, score }, idx) => {
        const qualified = advanced.has(team.id);
        const value = single ? (singleScored && score != null ? score : '–') : wins;
        return (
          <div key={team.id}
               className={`flex items-center gap-1.5 px-2 py-1 ${idx === 0 ? 'border-b border-slate-100 dark:border-slate-800' : ''}`}>
            <span className={`flex-1 text-[11px] truncate ${
              qualified ? 'font-bold text-slate-900 dark:text-slate-50' : 'font-medium text-slate-600 dark:text-slate-300'
            }`}>
              {team.shortName ?? team.name.slice(0, 3).toUpperCase()}
            </span>
            {qualified && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}
                   className="w-3 h-3 text-emerald-500 shrink-0">
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <span className="text-[11px] font-bold tabular-nums text-slate-700 dark:text-slate-200">{value}</span>
          </div>
        );
      })}
    </div>
  );

  return linkable && target
    ? <Link href={`/matches/${target.id}`} className="block shrink-0">{content}</Link>
    : content;
}

export function PlayoffBracket({ matches, currentMatchId, linkable = false }: {
  matches: SeasonMatch[];
  /** Resalta y centra la serie que contiene este partido (modo ficha de partido) */
  currentMatchId?: string;
  /** Si true, cada micro-cuadro enlaza a su partido. Informativo por defecto. */
  linkable?: boolean;
}) {
  const { t } = useT();
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const phases = useMemo(() => {
    const byPhase = groupByPhase(matches);
    const series: Record<PlayoffPhase, PlayoffSeries[]> = {
      Cuartos: buildSeries(byPhase.Cuartos),
      Semis:   buildSeries(byPhase.Semis),
      Final:   buildSeries(byPhase.Final),
    };
    return series;
  }, [matches]);

  // Equipos clasificados por fase (aparecen en la fase siguiente)
  const advanced: Record<PlayoffPhase, Set<string>> = useMemo(() => ({
    Cuartos: advancedFrom(phases.Semis),
    Semis:   advancedFrom(phases.Final),
    Final:   new Set<string>(), // el campeón se decide al cerrar la serie
  }), [phases]);

  const hasSeries = PLAYOFF_PHASES.some((p) => phases[p].length > 0);

  // Centrar la eliminatoria del partido actual al montar
  useEffect(() => {
    if (collapsed) return;
    const node = scrollRef.current?.querySelector('[data-current="true"]') as HTMLElement | null;
    node?.scrollIntoView({ behavior: 'instant', inline: 'center', block: 'nearest' });
  }, [collapsed]);

  if (!hasSeries) return null;

  return (
    <div className="card overflow-hidden">
      {/* Cabecera colapsable */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-2.5 min-h-[44px]"
        aria-expanded={!collapsed}
      >
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {t('playoffs.bracket_title')}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
             className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {!collapsed && (
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto px-4 pb-3 scrollbar-none"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {PLAYOFF_PHASES.filter((p) => phases[p].length > 0).map((phase) => (
            <div key={phase} className="shrink-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1.5">
                {phase === 'Cuartos' ? t('playoffs.quarters') : phase === 'Semis' ? t('playoffs.semis') : t('playoffs.final')}
              </p>
              {/* Las series de la fase, apiladas y centradas verticalmente */}
              <div className="flex flex-col justify-center gap-2 min-h-full">
                {phases[phase].map((serie, i) => (
                  <MicroSeries
                    key={i}
                    serie={serie}
                    advanced={advanced[phase]}
                    linkable={linkable}
                    isCurrent={!!currentMatchId && serie.games.some((g) => g.id === currentMatchId)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
