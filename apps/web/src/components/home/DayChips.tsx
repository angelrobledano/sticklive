'use client';

import type { DayFilter } from '@/lib/day-view';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';

/**
 * Filtros de la jornada (spec 2026-10-16, chip "Directo" de FotMob): "En
 * directo" solo aparece si hay partidos en juego ese día y "Siguiendo" solo si
 * juega algo que sigues. Son excluyentes y se desactivan con otro toque.
 */
export function DayChips({ liveCount, followingCount, filter, onChange, degraded = false }: {
  liveCount: number;
  followingCount: number;
  filter: DayFilter;
  onChange: (filter: DayFilter) => void;
  /** El refresco del directo está fallando: aviso "Reconectando…". */
  degraded?: boolean;
}) {
  const { t } = useT();
  if (liveCount === 0 && followingCount === 0) return null;

  const base = `inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold
                transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion
                dark:focus-visible:ring-rink-accent`;
  const count = 'tabular-nums font-normal opacity-80';

  return (
    <div role="group" aria-label={tt(t, 'home.filters', 'Filtrar partidos')} className="flex items-center gap-2 pb-3">
      {liveCount > 0 && (
        <button
          type="button"
          aria-pressed={filter === 'live'}
          onClick={() => onChange(filter === 'live' ? 'all' : 'live')}
          className={`${base} ${filter === 'live'
            ? 'border-live-deep bg-live-deep text-white'
            : 'border-live/40 bg-white text-live-deep hover:bg-live/10 dark:bg-slate-900 dark:text-live'}`}
        >
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${filter === 'live' ? 'bg-white' : 'bg-live'}`} />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${filter === 'live' ? 'bg-white' : 'bg-live'}`} />
          </span>
          {tt(t, 'home.filter_live', 'En directo')}
          <span className={count}>{liveCount}</span>
        </button>
      )}
      {followingCount > 0 && (
        <button
          type="button"
          aria-pressed={filter === 'following'}
          onClick={() => onChange(filter === 'following' ? 'all' : 'following')}
          className={`${base} ${filter === 'following'
            ? 'border-rink-passion bg-rink-passion text-white'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'}`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-3 w-3">
            <path d="M12 2l3.09 6.26L22 9.27l-4.91 4.79 1.16 6.94L12 17.77l-6.25 3.23 1.16-6.94L2 9.27l6.91-1.01L12 2z" />
          </svg>
          {tt(t, 'home.filter_following', 'Siguiendo')}
          <span className={count}>{followingCount}</span>
        </button>
      )}
      {degraded && liveCount > 0 && (
        <span className="truncate text-[11px] font-medium text-rose-500 dark:text-rose-400" role="status" aria-live="polite">
          {tt(t, 'match_states.live_reconnecting', 'Reconectando…')}
        </span>
      )}
    </div>
  );
}
