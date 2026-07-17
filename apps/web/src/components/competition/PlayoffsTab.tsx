'use client';

import { useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n';
import type { SeasonMatch, SeasonStandingRow } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { TeamName as AdaptiveTeamName } from '@/components/shared/TeamName';
import { PlayoffBracket } from '@/components/match/PlayoffBracket';
import { buildSeries, groupByPhase, placementMatches, type PlayoffSeries } from '@/lib/playoff';
import { fmtDate, fmtTime } from './format';

const PLAYOFF_PHASES = ['Cuartos', 'Semis', 'Final'] as const;
type PlayoffPhase = typeof PLAYOFF_PHASES[number];

// ─── Series de playoff (lógica compartida en @/lib/playoff) ─────────────────

/**
 * Eliminatoria a PARTIDO ÚNICO: tarjeta de partido limpia (sin marcador de
 * victorias de serie, que ahí sobra y confunde). Resalta al ganador y enlaza.
 */
function SingleMatchSeries({ serie, label }: { serie: PlayoffSeries; label: string }) {
  const g = serie.games[0]!;
  const isFinished = g.status === 'finished';
  const isLive = g.status === 'live';
  const showScore = isFinished || isLive;
  const sides = [
    { team: g.homeTeam, score: g.score.home },
    { team: g.awayTeam, score: g.score.away },
  ];

  const card = (
    <div className={`card overflow-hidden border ${isLive ? 'border-emerald-400/40' : 'border-slate-200 dark:border-slate-800'}`}>
      <div className="px-3 pt-2.5 pb-1 flex items-center justify-between">
        <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{label}</p>
        {isLive && <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">● Live</span>}
      </div>
      {sides.map(({ team, score }, idx) => {
        // Ganador explícito (penaltis/prórroga) manda; si no, se deriva del
        // marcador. Un empate sin ganador explícito no resalta a nadie.
        const winnerId = g.winnerTeamId
          ?? (g.score.home != null && g.score.away != null && g.score.home !== g.score.away
              ? (g.score.home > g.score.away ? g.homeTeam.id : g.awayTeam.id)
              : null);
        const winner = showScore && winnerId === team.id;
        return (
          <div key={idx} className={`flex items-center gap-2.5 px-3 py-2 ${idx === 0 ? 'border-b border-slate-100 dark:border-slate-800' : ''} ${!showScore ? 'opacity-60' : ''}`}>
            <TeamShield teamId={team.id} teamName={team.shortName ?? team.name} size={24} />
            <span className={`flex-1 text-sm truncate ${winner ? 'font-bold text-slate-900 dark:text-slate-50' : 'font-medium text-slate-700 dark:text-slate-300'}`}>
              <AdaptiveTeamName name={team.name} shortName={team.shortName} mobile="abbr" />
            </span>
            {showScore && score != null && (
              <span className="font-score text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">{score}</span>
            )}
          </div>
        );
      })}
      <div className="px-3 pb-2 pt-1">
        <span className={`text-[9px] font-bold uppercase tracking-wider ${isLive ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'}`}>
          {isLive ? '🟢 En directo'
            : isFinished ? `Final · ${fmtDate(g.finishedAt ?? g.scheduledAt)}`
            : `${fmtDate(g.scheduledAt)} · ${fmtTime(g.scheduledAt)}`}
        </span>
      </div>
    </div>
  );

  return <Link href={`/matches/${g.id}`} className="block hover:opacity-90 transition-opacity">{card}</Link>;
}

function SeriesCard({ serie, label }: { serie: PlayoffSeries; label: string }) {
  const { t } = useT();
  // Partido único → tarjeta de partido (sin marcador de victorias de serie).
  if (serie.games.length === 1) return <SingleMatchSeries serie={serie} label={label} />;
  const hasLive = serie.games.some((g) => g.status === 'live');
  const notStarted = serie.winsA === 0 && serie.winsB === 0 && !hasLive;
  const rows = [
    { team: serie.teamA, wins: serie.winsA, winner: serie.winsA > serie.winsB },
    { team: serie.teamB, wins: serie.winsB, winner: serie.winsB > serie.winsA },
  ];

  return (
    <div className={`card overflow-hidden border ${hasLive ? 'border-emerald-400/40' : 'border-slate-200 dark:border-slate-800'}`}>
      <div className="px-3 pt-2.5 pb-1 flex items-center justify-between">
        <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{label}</p>
        {/* No mostramos "al mejor de N": el formato varía por torneo y no es
            inferible de los partidos programados. Los badges de victorias ya
            cuentan la serie por sí solos. */}
        {hasLive && (
          <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">● {t('playoffs.live')}</span>
        )}
      </div>

      {rows.map(({ team, wins, winner }, idx) => (
        <div key={team.id}
             className={`flex items-center gap-2.5 px-3 py-2 ${idx === 0 ? 'border-b border-slate-100 dark:border-slate-800' : ''}
                         ${notStarted ? 'opacity-60' : ''}`}>
          <TeamShield teamId={team.id} teamName={team.shortName ?? team.name} size={24} />
          <Link href={`/teams/${team.id}`}
                className={`flex-1 text-sm truncate hover:underline ${winner ? 'font-bold text-slate-900 dark:text-slate-50' : 'font-medium text-slate-700 dark:text-slate-300'}`}>
            <AdaptiveTeamName name={team.name} shortName={team.shortName} mobile="abbr" />
          </Link>
          {/* Victorias de la serie — badge para diferenciarlo de un marcador de partido */}
          <span className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-1 rounded-md
                            font-score text-sm font-bold tabular-nums ${
            winner
              ? 'bg-rink-passion text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
          }`}>
            {wins}
          </span>
        </div>
      ))}

      {/* Partidos de la serie — pills neutras, siglas siempre */}
      <div className="flex flex-wrap gap-1.5 px-3 py-2">
        {serie.games.map((g) => (
          <Link key={g.id} href={`/matches/${g.id}`}
                className={`text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full transition-colors ${
                  g.status === 'live'
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                    : g.status === 'finished'
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-rink-passion'
                      : 'bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-600'
                }`}>
            {g.status === 'finished' || g.status === 'live'
              ? `${(g.homeTeam.shortName ?? g.homeTeam.name).slice(0, 4)} ${g.score.home ?? '-'}-${g.score.away ?? '-'} ${(g.awayTeam.shortName ?? g.awayTeam.name).slice(0, 4)}`
              : fmtDate(g.scheduledAt)}
          </Link>
        ))}
      </div>
    </div>
  );
}

type PlayoffViewPhase = PlayoffPhase | '9º–10º';

/** Slugs de fase para la URL (?phase=). */
const PHASE_SLUG: Record<PlayoffViewPhase, string> = {
  'Cuartos': 'cuartos', 'Semis': 'semis', 'Final': 'final', '9º–10º': '9-10',
};
function phaseFromSlug(s: string | null): PlayoffViewPhase | null {
  if (!s) return null;
  return (Object.keys(PHASE_SLUG) as PlayoffViewPhase[]).find((p) => PHASE_SLUG[p] === s) ?? null;
}

export function PlayoffsTab({ matches }: { standings?: SeasonStandingRow[]; matches: SeasonMatch[] }) {
  const { t } = useT();
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fases por roundNumber (1=QF, 2=SF, 3=F — derivado por la API).
  const byPhase = useMemo(() => groupByPhase(matches), [matches]);
  // Serie de colocación 9º–10º (rn=0): fuera del cuadro por el título,
  // pero decide la última plaza europea — fase propia.
  const placement = useMemo(() => placementMatches(matches), [matches]);

  // Pre-render filtering: SOLO fases con partidos reales (matches.length > 0).
  const visiblePhases = useMemo<PlayoffViewPhase[]>(() => [
    ...PLAYOFF_PHASES.filter((p) => (byPhase[p]?.length ?? 0) > 0),
    ...(placement.length > 0 ? (['9º–10º'] as const) : []),
  ], [byPhase, placement]);

  // Fase activa desde la URL (validada contra las visibles); si no, la primera.
  const requested = phaseFromSlug(sp.get('phase'));
  const activePhase: PlayoffViewPhase =
    requested && visiblePhases.includes(requested) ? requested : (visiblePhases[0] ?? 'Final');

  // Redirección elegante: si la URL pide una fase vacía/inexistente, normaliza a
  // la primera con contenido (solo si había un ?phase= explícito).
  useEffect(() => {
    const raw = sp.get('phase');
    if (!raw || visiblePhases.length === 0) return;
    if (requested && visiblePhases.includes(requested)) return;
    const params = new URLSearchParams(sp.toString());
    params.set('phase', PHASE_SLUG[visiblePhases[0]!]);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }, [sp, requested, visiblePhases, pathname, router]);

  const selectPhase = (phase: PlayoffViewPhase) => {
    const params = new URLSearchParams(sp.toString());
    params.set('phase', PHASE_SLUG[phase]);
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  const renderPhase = (phase: PlayoffViewPhase) => {
    if (phase === '9º–10º') {
      const series = buildSeries(placement);
      return (
        <div className="space-y-3">
          {/* Contexto: sin él, este cruce parece un descenso */}
          <p className="px-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {t('playoffs.placement_help')}
          </p>
          {series.map((serie, i) => (
            <SeriesCard key={i} serie={serie} label={t('playoffs.placement_label')} />
          ))}
        </div>
      );
    }

    const series = buildSeries(byPhase[phase]);
    if (series.length === 0) {
      return (
        <div className="card p-6 text-center opacity-60">
          <p className="text-sm text-slate-400 dark:text-slate-600">
            {phase === 'Cuartos' ? t('playoffs.no_quarters') : phase === 'Semis' ? t('playoffs.pending_quarters') : t('playoffs.pending_semis')}
          </p>
        </div>
      );
    }
    const labelOf = (i: number) => phase === 'Cuartos' ? t('playoffs.quarter_n', { n: i + 1 }) : phase === 'Semis' ? t('playoffs.semifinal_n', { n: i + 1 }) : t('playoffs.grand_final');
    return (
      <div className="space-y-3">
        {series.map((serie, i) => (
          <SeriesCard
            key={i}
            serie={serie}
            label={labelOf(i)}
          />
        ))}
      </div>
    );
  };

  const phaseLabel = (phase: PlayoffViewPhase) =>
    phase === '9º–10º' ? t('playoffs.placement')
    : phase === 'Cuartos' ? t('playoffs.quarters')
    : phase === 'Semis' ? t('playoffs.semis')
    : t('playoffs.final');

  return (
    <div className="space-y-3">
      {/* Vista general del cuadro por el título — informativa, sin enlaces */}
      <PlayoffBracket matches={matches} />

      {/* Sub-pestañas horizontales — solo las fases con contenido. Si solo hay
          una (o ninguna), no mostramos la barra: no aporta nada navegable. */}
      {visiblePhases.length > 1 && (
        <div className="flex gap-0 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800">
          {visiblePhases.map((phase) => (
            <button
              key={phase}
              onClick={() => selectPhase(phase)}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap ${
                activePhase === phase
                  ? 'bg-rink-passion text-white'
                  : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {phaseLabel(phase)}
            </button>
          ))}
        </div>
      )}

      {/* Contenido de la fase activa */}
      {visiblePhases.length > 0 && (
        <div ref={scrollRef}>
          {renderPhase(activePhase)}
        </div>
      )}
    </div>
  );
}
