'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Match } from '@/lib/api/client';
import { MatchCard } from './MatchCard';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';

const CAPTION_CLS = 'text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400';

/**
 * Grupo de competición de la vista de próximos (#414), con dos chasis:
 *  · Móvil: PLEGABLE — por defecto contraído (caption + recuento + chevron),
 *    un toque despliega. La fila entera es el botón (capa inferior, como la
 *    capa de enlace de MatchCard) y el caption-link flota encima.
 *  · Escritorio (md+): siempre desplegado — el masonry de la banda necesita el
 *    contenido visible y hay espacio de sobra.
 */
export function UpcomingGroup({ name, id, matches, defaultCollapsed = true }: {
  name: string | null;
  id: string | null;
  matches: Match[];
  defaultCollapsed?: boolean;
}) {
  const { t } = useT();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const label = name ?? tt(t, 'common.other_competitions', 'Otras competiciones');
  const n = matches.length;

  const caption = (extra: string) =>
    id ? (
      <Link href={`/competitions/${id}`} className={`${CAPTION_CLS} ${extra} hover:text-rink-passion transition-colors`}>
        {label}
      </Link>
    ) : (
      <p className={`${CAPTION_CLS} ${extra}`}>{label}</p>
    );

  return (
    <section className="mb-5 break-inside-avoid">
      {/* Móvil: fila plegable */}
      <div className="relative md:hidden">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={label}
          className="absolute inset-0 z-0 flex w-full items-center rounded-lg
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion"
        >
          <span className="sr-only">{label}</span>
        </button>
        <div className="pointer-events-none relative z-10 flex items-center justify-between px-1 py-1.5">
          {caption('pointer-events-auto inline-block')}
          <span className="flex items-center gap-1.5 pr-1">
            <span className="text-[11px] font-light text-slate-500 dark:text-slate-400 tabular-nums">
              {n} {n === 1 ? t('common.match_lc') : t('common.matches_lc')}
            </span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                 aria-hidden="true"
                 className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150
                             ${collapsed ? '' : 'rotate-180'}`}>
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </div>

      {/* Escritorio: caption estático, siempre desplegado */}
      <div className="hidden md:block pb-1.5">
        {caption('inline-block')}
      </div>

      <ul className={collapsed ? 'hidden md:block space-y-2' : 'space-y-2'}>
        {matches.map((m) => (
          <li key={m.id}>
            <MatchCard match={m} />
          </li>
        ))}
      </ul>
    </section>
  );
}
