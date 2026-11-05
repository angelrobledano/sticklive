'use client';

import { useViewerTz } from '@/hooks/useViewerTz';
import { isTimeTbd, timeTbdLabel } from '@sports/core/match-time';
import { useMemo, useState } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { TeamShield } from '@/components/shared/TeamShield';
import { useT } from '@/lib/i18n';
import { clubName } from '@sports/core/names';
import type { TeamMatchSummary } from '@sports/core/api';
import { calendarCounts, filterTeamMatches, teamResult, type CalendarFilter, type TeamResult } from '@sports/core/team-calendar';

const RESULT_STYLE: Record<TeamResult, string> = {
  W: 'bg-emerald-600 text-white',
  D: 'bg-slate-400 text-white dark:bg-slate-500',
  L: 'bg-rink-passion text-white',
};

function upperFirst(s: string) {
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

/**
 * Fila del calendario: jornada y fecha a la izquierda, los dos equipos con su
 * escudo (local arriba, como en un marcador) y el resultado del equipo a la
 * derecha. Sin "@"/"vs": el orden ya dice quién es local.
 */
function CalendarRow({ match, teamId, roundLabel }: { match: TeamMatchSummary; teamId: string; roundLabel: string | null }) {
  const { t, locale } = useT();
  const tz = useViewerTz();
  const when = match.scheduledAt ?? match.finishedAt;
  const date = when ? new Date(when) : null;
  const live = match.status === 'live';
  const showScore = match.status === 'finished' || live;
  const result = teamResult(teamId, match);

  const day = date ? date.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: tz }).replace('.', '') : '—';
  const weekday = date ? date.toLocaleDateString(locale, { weekday: 'short', timeZone: tz }).replace('.', '') : '';
  const hour = !date ? '' : isTimeTbd(date.toISOString()) ? timeTbdLabel(locale) : date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz });

  const side = (team: TeamSummaryLike, score: number | null) => {
    const me = team.id === teamId;
    return (
      <div className="flex items-center gap-2.5">
        <TeamShield teamId={team.id} teamName={team.name} size={22} className="shrink-0" />
        <span className={`min-w-0 flex-1 truncate text-sm ${me ? 'font-semibold text-slate-900 dark:text-slate-50' : 'text-slate-600 dark:text-slate-300'}`}>
          {clubName(team.name)}
        </span>
        {showScore && (
          <span className={`font-score text-base tabular-nums ${me ? 'font-bold text-slate-900 dark:text-slate-50' : 'text-slate-600 dark:text-slate-300'}`}>
            {score ?? 0}
          </span>
        )}
      </div>
    );
  };

  return (
    <Link
      href={`/matches/${match.id}`}
      className="flex items-stretch gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
    >
      {/* Cuándo: jornada, día y hora */}
      <div className="flex w-14 shrink-0 flex-col justify-center border-r border-slate-100 pr-3 dark:border-slate-800">
        {roundLabel && (
          <span className="truncate text-[10px] font-bold uppercase tracking-wide text-rink-passion dark:text-rose-400">{roundLabel}</span>
        )}
        <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">{day}</span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">{showScore ? weekday : `${weekday} ${hour}`}</span>
      </div>

      {/* Quién: local arriba, visitante abajo */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
        {side(match.homeTeam, match.score.home)}
        {side(match.awayTeam, match.score.away)}
      </div>

      {/* Cómo acabó */}
      <div className="flex w-8 shrink-0 items-center justify-center">
        {live ? (
          <span className="relative flex h-2.5 w-2.5" aria-label={t('playoffs.live')}>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
          </span>
        ) : result ? (
          <span
            className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${RESULT_STYLE[result]}`}
            title={t(`team_calendar.res_${result}_full`)}
          >
            {t(`team_calendar.res_${result}`)}
          </span>
        ) : (
          <span className="font-score text-xs font-semibold tabular-nums text-slate-400">{hour}</span>
        )}
      </div>
    </Link>
  );
}

type TeamSummaryLike = TeamMatchSummary['homeTeam'];

function Chip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: React.ReactNode; count?: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
          : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      {children}
      {count != null && <span className={`tabular-nums ${active ? 'opacity-70' : 'text-slate-400'}`}>{count}</span>}
    </button>
  );
}

export function TeamCalendar({
  matches, teamId, roundLabelFor,
}: {
  matches: TeamMatchSummary[];
  teamId: string;
  /** Etiqueta de ronda en eliminatorias (semis, final…); si no, la jornada. */
  roundLabelFor?: (m: TeamMatchSummary) => string | null;
}) {
  const { t, locale } = useT();
  const [filter, setFilter] = useState<Required<CalendarFilter>>({ status: 'all', venue: 'all', result: 'all' });
  const counts = useMemo(() => calendarCounts(matches, teamId), [matches, teamId]);
  const visible = useMemo(() => filterTeamMatches(matches, teamId, filter), [matches, teamId, filter]);
  const set = (patch: Partial<CalendarFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const dirty = filter.status !== 'all' || filter.venue !== 'all' || filter.result !== 'all';

  // Agrupado por mes, anclado en Madrid: el mes no cambia por 1 h de zona.
  const groups = new Map<string, TeamMatchSummary[]>();
  for (const m of visible) {
    const date = new Date(m.scheduledAt ?? m.finishedAt ?? '');
    const key = isNaN(date.getTime()) ? t('team.no_date')
      : upperFirst(date.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  const label = (m: TeamMatchSummary) =>
    roundLabelFor?.(m) ?? (m.roundNumber != null ? t('team_calendar.round_short', { n: m.roundNumber }) : null);

  return (
    <div className="space-y-4">
      <div role="group" aria-label={t('team_calendar.label')} className="space-y-2">
        <div className="flex gap-1.5">
          <Chip active={filter.status === 'all'} onClick={() => set({ status: 'all' })} count={counts.all}>{t('team_calendar.all')}</Chip>
          <Chip active={filter.status === 'played'} onClick={() => set({ status: 'played' })} count={counts.played}>{t('team_calendar.played')}</Chip>
          <Chip active={filter.status === 'upcoming'} onClick={() => set({ status: 'upcoming', result: 'all' })} count={counts.upcoming}>{t('team_calendar.upcoming')}</Chip>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={filter.venue === 'home'} onClick={() => set({ venue: filter.venue === 'home' ? 'all' : 'home' })} count={counts.home}>{t('team_calendar.home')}</Chip>
          <Chip active={filter.venue === 'away'} onClick={() => set({ venue: filter.venue === 'away' ? 'all' : 'away' })} count={counts.away}>{t('team_calendar.away')}</Chip>
          {filter.status !== 'upcoming' && counts.W + counts.D + counts.L > 0 && (
            <>
              <span className="mx-0.5 h-5 w-px bg-slate-200 dark:bg-slate-700" />
              {(['W', 'D', 'L'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={filter.result === r}
                  aria-label={`${t(`team_calendar.res_${r}_full`)} (${counts[r]})`}
                  title={t(`team_calendar.res_${r}_full`)}
                  onClick={() => set({ result: filter.result === r ? 'all' : r })}
                  className={`inline-flex items-center gap-1 rounded-full border py-1 pl-1 pr-2 text-xs font-semibold transition ${
                    filter.result === r ? 'border-transparent ring-2 ring-slate-900 dark:ring-slate-100' : 'border-slate-200 dark:border-slate-700'
                  } text-slate-700 dark:text-slate-200`}
                >
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${RESULT_STYLE[r]}`}>{t(`team_calendar.res_${r}`)}</span>
                  <span className="tabular-nums">{counts[r]}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('team_calendar.no_matches')}</p>
          {dirty && (
            <button type="button" onClick={() => setFilter({ status: 'all', venue: 'all', result: 'all' })} className="mt-2 text-sm font-semibold text-rink-passion">
              {t('team_calendar.clear')}
            </button>
          )}
        </div>
      ) : (
        Array.from(groups.entries()).map(([month, group]) => (
          <div key={month} className="card overflow-hidden">
            <p className="px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{month}</p>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {group.map((m) => <CalendarRow key={m.id} match={m} teamId={teamId} roundLabel={label(m)} />)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
