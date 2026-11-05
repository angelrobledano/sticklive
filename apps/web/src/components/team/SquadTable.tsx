'use client';

import { useMemo, useState } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { PlayerAvatar } from '@/components/shared/PlayerAvatar';
import { useT } from '@/lib/i18n';
import { playerDisplayName, toTitleCase } from '@sports/core/names';
import type { SquadPlayer } from '@sports/core/api';

type Col = 'played' | 'goals' | 'assists' | 'blueCards' | 'redCards' | 'directFouls' | 'penalties';

/** Columnas de la línea de cada jugador. FD y PE solo desde tablet: en móvil no caben. */
const COLS: Array<{ key: Col; label: string; title: string; tone?: string; wide?: boolean }> = [
  { key: 'played', label: 'player.col_pj', title: 'squad_table.played' },
  { key: 'goals', label: 'player.col_g', title: 'squad_table.goals' },
  { key: 'assists', label: 'player.col_as', title: 'squad_table.assists' },
  { key: 'blueCards', label: 'player.col_az', title: 'squad_table.blue', tone: 'text-blue-600 dark:text-blue-400' },
  { key: 'redCards', label: 'player.col_rj', title: 'squad_table.red', tone: 'text-red-600 dark:text-red-400' },
  { key: 'directFouls', label: 'player.col_fd', title: 'squad_table.direct_fouls', wide: true },
  { key: 'penalties', label: 'player.col_pe', title: 'squad_table.penalties', wide: true },
];

const val = (p: SquadPlayer, k: Col) => p[k] ?? 0;

export function SquadTable({ players, title }: { players: SquadPlayer[]; title: string }) {
  const { t } = useT();
  const [sort, setSort] = useState<Col | null>(null);

  const rows = useMemo(() => {
    if (!sort) return players;
    return [...players].sort((a, b) => val(b, sort) - val(a, sort) || (a.jerseyNumber ?? 99) - (b.jerseyNumber ?? 99));
  }, [players, sort]);

  // El máximo de cada columna se resalta: de un vistazo, quién lidera el equipo.
  const max = useMemo(() => {
    const m: Partial<Record<Col, number>> = {};
    for (const c of COLS) m[c.key] = Math.max(0, ...players.map((p) => val(p, c.key)));
    return m;
  }, [players]);

  const grid = 'grid grid-cols-[1.5rem_minmax(0,1fr)_repeat(5,1.9rem)] sm:grid-cols-[1.5rem_minmax(0,1fr)_repeat(7,2.4rem)] items-center gap-x-1';

  return (
    <div className="card overflow-hidden">
      <div className={`${grid} border-b border-slate-100 px-3 pb-2 pt-3 dark:border-slate-800`}>
        <span />
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{title}</p>
        {COLS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setSort(sort === c.key ? null : c.key)}
            aria-pressed={sort === c.key}
            title={t(c.title)}
            className={`${c.wide ? 'hidden sm:block' : ''} rounded py-0.5 text-center text-[10px] font-bold uppercase ${
              sort === c.key ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            {t(c.label)}
          </button>
        ))}
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
        {rows.map((p) => (
          <Link
            key={p.playerId}
            href={`/players/${p.playerId}`}
            className={`${grid} group px-3 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60`}
          >
            <span className="text-center font-mono text-xs text-slate-500 dark:text-slate-400">{p.jerseyNumber ?? '—'}</span>
            <span className="flex min-w-0 items-center gap-2">
              <PlayerAvatar photoUrl={p.photoUrl} name={`${p.firstName} ${p.lastName}`} className="h-8 w-8 shrink-0 rounded-full" />
              <span
                className="truncate text-sm font-medium text-slate-800 transition-colors group-hover:text-rink-passion dark:text-slate-200"
                title={toTitleCase(`${p.firstName} ${p.lastName}`)}
              >
                {playerDisplayName(p.firstName, p.lastName)}
              </span>
            </span>
            {COLS.map((c) => {
              const v = val(p, c.key);
              const top = v > 0 && v === max[c.key] && c.key !== 'played';
              return (
                <span
                  key={c.key}
                  className={`${c.wide ? 'hidden sm:block' : ''} text-center font-score text-xs tabular-nums ${
                    v === 0 ? 'text-slate-300 dark:text-slate-600'
                      : top ? `font-bold ${c.tone ?? 'text-rink-passion dark:text-rose-400'}`
                        : `font-semibold ${c.tone ?? 'text-slate-800 dark:text-slate-200'}`
                  }`}
                >
                  {v}
                </span>
              );
            })}
          </Link>
        ))}
      </div>
    </div>
  );
}
