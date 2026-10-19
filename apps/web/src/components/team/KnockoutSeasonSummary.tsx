'use client';

import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { Fragment, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { TeamDetail, TeamMatchSummary } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import {
  knockoutPhaseLabel,
  type KnockoutPhaseView,
  type KnockoutSeriesView,
  type KnockoutSummary,
} from '@/lib/knockout';
import { fmtDate, fmtTime } from '@/components/competition/format';
import { TeamShield } from '@/components/shared/TeamShield';
import { TrophyIcon } from '@/components/match/icons';
import { clubName } from '@/lib/names';

/**
 * Resumen de la participación del equipo en una competición ELIMINATORIA
 * (Supercopa, Copa del Rey, Final Four, playoffs…). Sustituye a la tarjeta de
 * clasificación cuando el formato declarado de la competición es
 * `bracket`/`final_four`: una eliminatoria no tiene clasificación, y mostrar
 * "Sin datos de clasificación" parecía un fallo de datos.
 *
 * Es una SÍNTESIS, no un duplicado del Calendario: qué ronda jugó el equipo,
 * cómo le fue en cada eliminatoria, si avanzó o quedó eliminado, y el título
 * si lo ganó. El detalle partido a partido sigue en Calendario y en la vista
 * de competición (enlazada en la cabecera).
 *
 * Los datos de la fuente tienen calidad variable; `buildKnockoutSummary`
 * decide cuánto estructura se puede afirmar (fases reales > cadena de avance
 * > modo conservador). Este componente nunca inventa fases ni campeón.
 */

// ─── Piezas de la eliminatoria ─────────────────────────────────────────────

function resultPillClass(result: KnockoutSeriesView['result']): string {
  switch (result) {
    case 'won': return 'bg-emerald-500';
    case 'lost': return 'bg-red-500';
    default: return 'bg-slate-300 dark:bg-slate-600';
  }
}

/** Marcador de un partido DESDE LA PERSPECTIVA del equipo. */
function teamScore(g: KnockoutSeriesView['games'][number], teamId: string): { my: number | null; opp: number | null } {
  const home = g.homeTeam.id === teamId;
  return { my: home ? g.score.home : g.score.away, opp: home ? g.score.away : g.score.home };
}

function SeriesRow({ serie, teamId, timezone }: {
  serie: KnockoutSeriesView;
  teamId: string;
  timezone: string | null | undefined;
}) {
  const { t, locale } = useT();
  const single = serie.games.length === 1;
  const first = serie.games[0]!;
  const isLive = serie.games.some((g) => g.status === 'live');

  return (
    <div className="py-3">
      <div className="flex items-center gap-3">
        {/* Resultado de la eliminatoria: V/D como la racha de la cabecera */}
        {serie.result !== 'open' ? (
          <div className={`w-7 h-7 rounded-full shrink-0 ${resultPillClass(serie.result)} flex items-center justify-center`}>
            <span className="text-white text-xs font-bold">
              {serie.result === 'won' ? t('team.form_w') : t('team.form_l')}
            </span>
          </div>
        ) : (
          <div className="w-7 h-7 rounded-full shrink-0 bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
            {isLive && <span className="w-2 h-2 rounded-full bg-live animate-pulse" aria-hidden="true" />}
          </div>
        )}

        <TeamShield teamId={serie.opponent.id} teamName={serie.opponent.name} size={28} />

        <p className="flex-1 min-w-0 text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
          {serie.opponent.shortName ?? serie.opponent.name}
        </p>

        {/* Eliminatoria a partido único: marcador directo. La ida/vuelta se
            detalla en chips debajo (como las series de playoff). */}
        {single && (first.status === 'finished' || isLive) ? (
          (() => {
            const { my, opp } = teamScore(first, teamId);
            return (
              <div className="text-right shrink-0">
                <span className="font-score text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">
                  {my ?? 0} – {opp ?? 0}
                </span>
                {serie.decidedBy && (
                  <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {serie.decidedBy === 'penalties' ? t('playoffs.pens_short') : t('playoffs.ot_short')}
                  </span>
                )}
              </div>
            );
          })()
        ) : single ? (
          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0 tabular-nums">
            {fmtDate(first.scheduledAt, timezone, locale)} · {fmtTime(first.scheduledAt, timezone, locale)}
          </span>
        ) : (
          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0 tabular-nums">
            {serie.winsFor}–{serie.winsAgainst}
          </span>
        )}
      </div>

      {/* Ida/vuelta: un chip por partido, enlazado a su ficha */}
      {!single && (
        <div className="flex flex-wrap gap-1.5 mt-2 pl-10">
          {serie.games.map((g, i) => {
            const { my, opp } = teamScore(g, teamId);
            const played = g.status === 'finished' || g.status === 'live';
            return (
              <Link key={g.id} href={`/matches/${g.id}`}
                    className={`inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-1 rounded-full transition-colors ${
                      g.status === 'live'
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                        : g.status === 'finished'
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-rink-passion'
                          : 'bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400'
                    }`}>
                <span className="text-[9px] tabular-nums opacity-60">{i + 1}</span>
                <span className="tabular-nums">{played ? `${my ?? '-'}–${opp ?? '-'}` : fmtDate(g.scheduledAt, timezone, locale)}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Una fase (semis, final…) con la(s) eliminatoria(s) del equipo. */
function PhaseSection({ phase, teamId, timezone, showEliminated }: {
  phase: KnockoutPhaseView;
  teamId: string;
  timezone: string | null | undefined;
  showEliminated: boolean;
}) {
  const { t } = useT();
  const singleGame = phase.series.length === 1 && phase.series[0]!.games.length === 1;
  const wrapper = (children: ReactNode) =>
    singleGame ? (
      <Link href={`/matches/${phase.series[0]!.games[0]!.id}`} className="block hover:opacity-90 transition-opacity">
        {children}
      </Link>
    ) : children;

  return (
    <section aria-label={knockoutPhaseLabel(phase, t)}>
      <div className="flex items-center justify-between px-0.5">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {knockoutPhaseLabel(phase, t)}
        </h4>
        {showEliminated && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
            {t('team.eliminated')}
          </span>
        )}
      </div>
      {wrapper(
        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
          {phase.series.map((s, i) => (
            <SeriesRow key={i} serie={s} teamId={teamId} timezone={timezone} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Tarjeta completa ──────────────────────────────────────────────────────

export function KnockoutSeasonSummary({ data, summary, renderMatch }: {
  data: TeamDetail;
  /** null = temporada eliminatoria sin partidos registrados (estado vacío). */
  summary: KnockoutSummary | null;
  /** Render de un partido para el modo de datos incompletos (MiniMatchCard). */
  renderMatch?: (m: TeamMatchSummary) => ReactNode;
}) {
  const { t } = useT();
  const competition = data.season?.competitionShort ?? data.season?.competitionName ?? null;
  const seasonName = data.seasons?.find((s) => s.id === data.selectedSeasonId)?.name ?? null;
  const timezone = data.matches[0]?.competitionTimezone;

  const heading = useMemo(() => {
    const parts = [competition, seasonName].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
  }, [competition, seasonName]);

  // Estado vacío: edición eliminatoria sin partidos (nunca "sin clasificación").
  if (!summary || summary.matches.length === 0) {
    return (
      <div className="card p-5 space-y-3">
        {(heading || competition) && (
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {heading ?? competition}
          </h3>
        )}
        <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
          {t('team.knockout_empty')}
        </p>
      </div>
    );
  }

  return (
    <div className="card p-5 space-y-4">
      {/* Qué competición y edición es */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {heading && (
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 truncate">{heading}</h3>
          )}
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mt-0.5">
            {t('team.knockout_tag')}
          </p>
        </div>
        {data.selectedSeasonId && (
          <Link href={data.season?.competitionId
                  ? `/competitions/${data.season.competitionId}?season=${data.selectedSeasonId}`
                  : `/competitions/${data.selectedSeasonId}`}
                className="text-xs font-medium text-rink-passion hover:underline shrink-0">
            {t('team.view_competition')} →
          </Link>
        )}
      </div>

      {/* Datos insuficientes: lista simple, sin fases inventadas */}
      {summary.incomplete ? (
        <>
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {t('team.knockout_incomplete')}
          </p>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {/* En runtime son los TeamMatchSummary de la ficha filtrados. */}
            {summary.matches.map((m) => (
              <Fragment key={m.id}>{renderMatch?.(m as TeamMatchSummary)}</Fragment>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Fases en orden cronológico: el camino del equipo hasta el título */}
          <div className="space-y-3">
            {summary.phases.map((p, i) => (
              <div key={i}>
                {i > 0 && (
                  <div className="flex justify-center pb-3" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                         className="w-4 h-4 text-slate-300 dark:text-slate-600">
                      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
                <PhaseSection
                  phase={p}
                  teamId={data.team.id}
                  timezone={timezone}
                  showEliminated={summary.eliminatedIn != null && p.phase === summary.eliminatedIn}
                />
              </div>
            ))}
          </div>

          {/* Título */}
          {summary.champion && (
            <div className="flex items-center gap-2.5 rounded-lg bg-rink-passion px-3.5 py-3 text-white">
              <TrophyIcon className="w-5 h-5 shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-90">
                {t('playoffs.champion')}
              </span>
              <span className="flex-1 truncate text-right text-sm font-bold">
                {clubName(data.team.name)}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
