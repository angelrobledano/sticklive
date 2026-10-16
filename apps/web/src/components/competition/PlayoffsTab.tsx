'use client';

import { useRef, useEffect, useMemo } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n';
import type { SeasonMatch, SeasonPhase, SeasonRound, SeasonStandingRow } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { TeamName as AdaptiveTeamName } from '@/components/shared/TeamName';
import { PlayoffBracket } from '@/components/match/PlayoffBracket';
import { TrophyIcon } from '@/components/match/icons';
import { KnockoutBracket, KnockoutMatchCard } from './KnockoutBracket';
import { knockoutPhaseViews, type KnockoutPhaseView } from '@/lib/season-phases';
import { FinalFourBracket } from './FinalFourBracket';
import { buildSeries, gameWinnerId, groupByPhase, placementMatches, seriesWinnerId, type PlayoffSeries } from '@/lib/playoff';
import { fmtDate, fmtTime } from './format';

const PLAYOFF_PHASES = ['Cuartos', 'Semis', 'Final'] as const;
type PlayoffPhase = typeof PLAYOFF_PHASES[number];

// ─── Series de playoff (lógica compartida en @/lib/playoff) ─────────────────

/**
 * Eliminatoria a PARTIDO ÚNICO: tarjeta de partido limpia (sin marcador de
 * victorias de serie, que ahí sobra y confunde). Resalta al ganador y enlaza.
 */
function SingleMatchSeries({ serie, label }: { serie: PlayoffSeries; label: string }) {
  const { t, locale } = useT();
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
        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{label}</p>
        {isLive && <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">● {t('playoffs.live')}</span>}
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
        <span className={`text-[10px] font-bold uppercase tracking-wider ${isLive ? 'text-emerald-500' : 'text-slate-500 dark:text-slate-400'}`}>
          {isLive ? `🟢 ${t('playoffs.live')}`
            : isFinished ? `${t('match_states.final')} · ${fmtDate(g.finishedAt ?? g.scheduledAt, undefined, locale)}`
            : `${fmtDate(g.scheduledAt, undefined, locale)} · ${fmtTime(g.scheduledAt, undefined, locale)}`}
        </span>
      </div>
    </div>
  );

  return <Link href={`/matches/${g.id}`} className="block hover:opacity-90 transition-opacity">{card}</Link>;
}

export function SeriesCard({ serie, label, isFinal = false }: { serie: PlayoffSeries; label: string; isFinal?: boolean }) {
  const { t, locale } = useT();
  // Partido único → tarjeta de partido (sin marcador de victorias de serie).
  if (serie.games.length === 1) return <SingleMatchSeries serie={serie} label={label} />;
  const hasLive = serie.games.some((g) => g.status === 'live');
  const notStarted = serie.winsA === 0 && serie.winsB === 0 && !hasLive;
  // Campeón: solo en la final por el título y solo con la serie ya cerrada.
  const championId = isFinal ? seriesWinnerId(serie) : null;
  const rows = [
    { team: serie.teamA, wins: serie.winsA, winner: serie.winsA > serie.winsB },
    { team: serie.teamB, wins: serie.winsB, winner: serie.winsB > serie.winsA },
  ];

  return (
    <div className={`card overflow-hidden border ${hasLive ? 'border-emerald-400/40' : 'border-slate-200 dark:border-slate-800'}`}>
      <div className="px-3 pt-2.5 pb-0.5 flex items-center justify-between">
        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{label}</p>
        {hasLive && (
          <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">● {t('playoffs.live')}</span>
        )}
      </div>

      {/* Rótulo de la columna de cifras: son VICTORIAS de la serie, no un
          marcador de partido (ese malentendido era el problema de claridad). */}
      <div className="px-3 flex justify-end">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {t('playoffs.series_wins')}
        </span>
      </div>

      {rows.map(({ team, wins, winner }, idx) => {
        const isChampion = championId === team.id;
        return (
          <div key={team.id}
               className={`flex items-center gap-2.5 px-3 py-2 ${idx === 0 ? 'border-b border-slate-100 dark:border-slate-800' : ''}
                           ${notStarted ? 'opacity-60' : ''}`}>
            <TeamShield teamId={team.id} teamName={team.shortName ?? team.name} size={24} />
            <Link href={`/teams/${team.id}`}
                  className={`flex-1 text-sm truncate hover:underline ${winner ? 'font-bold text-slate-900 dark:text-slate-50' : 'font-medium text-slate-700 dark:text-slate-300'}`}>
              <AdaptiveTeamName name={team.name} shortName={team.shortName} mobile="abbr" />
            </Link>
            {isChampion && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rink-passion px-1.5 py-0.5
                               text-[9px] font-bold uppercase tracking-wider text-white">
                <TrophyIcon className="w-3 h-3" />
                {t('playoffs.champion')}
              </span>
            )}
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
        );
      })}

      {/* Partidos de la serie — numerados; se marca penaltis/prórroga para que
          una victoria que no se lee en el marcador (p. ej. un 2-2) no confunda. */}
      <div className="flex flex-wrap gap-1.5 px-3 py-2">
        {serie.games.map((g, i) => {
          const played = g.status === 'finished' || g.status === 'live';
          const winnerId = played ? gameWinnerId(g) : null;
          const decidedBy = g.winType === 'penalties' ? t('playoffs.pens_short')
            : g.winType === 'overtime' ? t('playoffs.ot_short') : null;
          const homeAbbr = (g.homeTeam.shortName ?? g.homeTeam.name).slice(0, 4);
          const awayAbbr = (g.awayTeam.shortName ?? g.awayTeam.name).slice(0, 4);
          return (
            <Link key={g.id} href={`/matches/${g.id}`}
                  className={`inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2.5 py-1 rounded-full transition-colors ${
                    g.status === 'live'
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                      : g.status === 'finished'
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-rink-passion'
                        : 'bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400'
                  }`}>
              <span className="text-[9px] tabular-nums opacity-60">{i + 1}</span>
              {played ? (
                <>
                  <span className={winnerId === g.homeTeam.id ? 'font-bold' : 'opacity-70'}>{homeAbbr}</span>
                  <span className="tabular-nums">{g.score.home ?? '-'}-{g.score.away ?? '-'}</span>
                  <span className={winnerId === g.awayTeam.id ? 'font-bold' : 'opacity-70'}>{awayAbbr}</span>
                  {decidedBy && <span className="text-[9px] font-bold uppercase opacity-80">{decidedBy}</span>}
                </>
              ) : (
                <span>{fmtDate(g.scheduledAt, undefined, locale)}</span>
              )}
            </Link>
          );
        })}
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

/**
 * Pestaña Playoffs. Con la estructura de la fuente (`phases`), cada fase
 * eliminatoria se pinta con el cuadro que le corresponde por su estructura
 * (series al mejor de N, final four o cuadro), sin depender del formato
 * declarado de la competición: así conviven clasificación de grupos y final
 * four, o liga y playoff. Sin fases (payload antiguo o temporada heredada) se
 * mantiene la presentación de siempre.
 */
export function PlayoffsTab({ rounds = [], matches, format, phases }: {
  standings?: SeasonStandingRow[];
  rounds?: SeasonRound[];
  matches: SeasonMatch[];
  format?: string;
  phases?: SeasonPhase[];
}) {
  const views = useMemo(() => knockoutPhaseViews(phases, rounds, matches), [phases, rounds, matches]);
  if (views && views.length > 0) return <PhasedPlayoffs views={views} />;
  return <LegacyPlayoffs rounds={rounds} matches={matches} format={format} />;
}

function PhasedPlayoffs({ views }: { views: KnockoutPhaseView[] }) {
  const { t } = useT();
  // Playoff a series (OK Liga): la fase por el título y la de colocación
  // (9.º-10.º) se navegan juntas, como siempre.
  const series = views.filter((v) => v.layout === 'series');
  const others = views.filter((v) => v.layout !== 'series');
  const titleCount = views.filter((v) => !v.phase.isPlacement).length;

  return (
    <div className="space-y-6">
      {series.length > 0 && <SeriesPlayoffs matches={series.flatMap((v) => v.matches)} />}
      {others.map((v) => (
        <section key={v.phase.id} className="space-y-3">
          {(v.phase.isPlacement || titleCount > 1) && (
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1">
              {v.phase.isPlacement ? t('playoffs.other_places') : (v.phase.name ?? t('match_tabs.playoffs'))}
              {v.phase.isPlacement && v.phase.name ? ` · ${v.phase.name}` : ''}
            </h3>
          )}
          {v.layout === 'final_four'
            ? <FinalFourBracket matches={v.matches} />
            : v.phase.isPlacement
              ? <PlacementList view={v} />
              : <KnockoutBracket rounds={v.rounds} matches={v.matches} />}
        </section>
      ))}
    </div>
  );
}

/** Fase de colocación a partido único (p. ej. puestos 5.º-8.º): partidos por ronda. */
function PlacementList({ view }: { view: KnockoutPhaseView }) {
  const byRound = new Map<string, SeasonMatch[]>();
  for (const m of view.matches) {
    const k = m.roundId ?? '';
    byRound.set(k, [...(byRound.get(k) ?? []), m]);
  }
  const order = view.rounds.slice().sort((a, b) => a.number - b.number);
  const groups = [
    ...order.filter((r) => byRound.has(r.id)).map((r) => ({ key: r.id, name: r.name, matches: byRound.get(r.id)! })),
    ...(byRound.has('') ? [{ key: 'none', name: null, matches: byRound.get('')! }] : []),
  ];
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.key} className="space-y-1.5">
          {g.name && <p className="px-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{g.name}</p>}
          {g.matches
            .slice()
            .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))
            .map((m) => <KnockoutMatchCard key={m.id} m={m} />)}
        </div>
      ))}
    </div>
  );
}

function LegacyPlayoffs({ rounds, matches, format }: { rounds: SeasonRound[]; matches: SeasonMatch[]; format?: string }) {
  // Eliminatoria con fases nombradas por la fuente (World Skate: Cuartos/Semis/
  // Final/3º-4º, a partido único). Se distingue del playoff de OK Liga (series
  // al mejor de N, fase derivada 1/2/3) porque trae roundNumber fuera de 1-3.
  // Para estas, un cuadro dedicado por nombre de fase.
  const isNamedKnockout = useMemo(
    () => matches.some((m) => m.roundType === 'playoff' && (m.roundNumber ?? 0) > 3),
    [matches],
  );

  // Final Four (Supercopa): cuadro propio Semifinal x2 → Final. Se decide por
  // el formato declarado en la competición, no por heurística de rondas.
  if (format === 'final_four') {
    return (
      <div className="space-y-3">
        <FinalFourBracket matches={matches} />
      </div>
    );
  }

  // Cuadro de eliminatorias: una competición DECLARADA como `bracket` (copas,
  // eliminatorias) siempre se dibuja como cuadro; además, las ligas con una
  // eliminatoria con fases de numeración alta (World Skate) también.
  if (format === 'bracket' || isNamedKnockout) {
    return (
      <div className="space-y-3">
        <KnockoutBracket rounds={rounds} matches={matches} />
      </div>
    );
  }

  return <SeriesPlayoffs matches={matches} />;
}

/** Playoff a series al mejor de N (OK Liga): cuadro general + fases navegables. */
function SeriesPlayoffs({ matches }: { matches: SeasonMatch[] }) {
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
          <p className="text-sm text-slate-500 dark:text-slate-400">
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
            isFinal={phase === 'Final'}
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
