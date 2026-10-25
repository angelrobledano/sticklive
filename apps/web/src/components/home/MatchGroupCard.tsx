'use client';

import { useId, useState, type ReactNode } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { CountryFlag } from '@/components/shared/CountryFlag';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';

/**
 * Tarjeta de un grupo de partidos de la home (spec 2026-10-16, referencia
 * FotMob): cabecera con icono, nombre (enlace a la competición), recuento y
 * botón de plegar, y las filas dentro separadas por filete. La usan las
 * competiciones del día, la tarjeta "Siguiendo" y Mi grada.
 */

const ICON_BOX = 'flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full';

/** Logo de la competición; si no hay, bandera del país, mundo ('W') o iniciales. */
export function CompetitionIcon({ country, name, logoUrl }: { country: string | null | undefined; name: string | null; logoUrl?: string | null }) {
  const [logoFailed, setLogoFailed] = useState(false);
  if (logoUrl && !logoFailed) {
    return (
      <span aria-hidden="true" className={`${ICON_BOX} border border-slate-200 bg-white p-px dark:border-slate-700`}>
        <img src={logoUrl} alt="" width={20} height={20} loading="lazy" decoding="async"
             onError={() => setLogoFailed(true)} className="h-full w-full object-contain" />
      </span>
    );
  }
  if (country === 'W') {
    return (
      <span data-icon="world" aria-hidden="true" className={`${ICON_BOX} bg-sky-50 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-3.5 w-3.5">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (country && country.length === 2) {
    return (
      <span aria-hidden="true" className={`${ICON_BOX} bg-slate-100 dark:bg-slate-800`}>
        <CountryFlag code={country} className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`${ICON_BOX} bg-rink-passion/10 text-[9px] font-black text-rink-passion dark:text-rink-accent`}>
      {(name ?? '·').slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Estrella rellena (siguiendo). */
export function FollowStar({ label }: { label?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" role={label ? 'img' : undefined} aria-label={label}
         aria-hidden={label ? undefined : true}
         className="h-3.5 w-3.5 shrink-0 text-rink-passion dark:text-rink-accent">
      <path d="M12 2l3.09 6.26L22 9.27l-4.91 4.79 1.16 6.94L12 17.77l-6.25 3.23 1.16-6.94L2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

export function MatchGroupCard({
  title, href, icon, count, followed = false, action, collapsible = true, children,
}: {
  title: string;
  /** Destino del título (ficha de la competición); null → texto plano. */
  href?: string | null;
  icon: ReactNode;
  count: number;
  /** La competición está entre las seguidas: estrella junto al título. */
  followed?: boolean;
  /** Acción extra en la cabecera (p. ej. "Gestionar" en Siguiendo). */
  action?: ReactNode;
  collapsible?: boolean;
  children: ReactNode;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const titleCls = 'line-clamp-2 break-words text-[13px] font-semibold leading-snug text-slate-800 dark:text-slate-100';

  return (
    <section className="card overflow-hidden" data-followed={followed ? 'true' : undefined}>
      <header className="flex min-h-[40px] items-center gap-2 border-b border-slate-100 bg-slate-50 pl-3 pr-1
                         dark:border-slate-800 dark:bg-slate-800/40">
        {icon}
        <h3 className="min-w-0 flex-1">
          {href ? (
            <Link href={href} className={`${titleCls} py-2 transition-colors hover:text-rink-passion dark:hover:text-rink-accent
                                          focus:outline-none focus-visible:underline`}>
              {title}
            </Link>
          ) : (
            <span className={`${titleCls} py-2`}>{title}</span>
          )}
        </h3>
        {followed && <FollowStar label={tt(t, 'favorites.following', 'Siguiendo')} />}
        {action}
        <span className={`shrink-0 text-[11px] tabular-nums text-slate-500 dark:text-slate-400 ${collapsible ? '' : 'pr-2'}`}>
          {count} {count === 1 ? t('common.match_lc') : t('common.matches_lc')}
        </span>
        {collapsible && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={open
              ? tt(t, 'home.collapse', 'Plegar {name}', { name: title })
              : tt(t, 'home.expand', 'Desplegar {name}', { name: title })}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors
                       hover:bg-slate-200/60 dark:text-slate-400 dark:hover:bg-slate-700/60
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"
                 className={`h-4 w-4 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </header>
      <div id={bodyId} hidden={!open} className="divide-y divide-slate-100 dark:divide-slate-800">
        {children}
      </div>
    </section>
  );
}
