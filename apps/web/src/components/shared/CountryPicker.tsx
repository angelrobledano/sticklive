'use client';

import { useMemo } from 'react';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';
import { usePreferredCountry, HOME_COUNTRIES } from '@/hooks/usePreferredCountry';
import { track } from '@/lib/analytics';

/**
 * Selector del país preferido (plan 2026-10-25, iteración 4). Ordena la home:
 * sus competiciones primero; las demás siguen ahí. `variant="chip"` para la
 * cabecera de la home, `"field"` para Ajustes.
 */
export function CountryPicker({ variant = 'chip' }: { variant?: 'chip' | 'field' }) {
  const { t, locale } = useT();
  const { country, setCountry } = usePreferredCountry();
  const names = useMemo(() => {
    try { return new Intl.DisplayNames([locale], { type: 'region' }); } catch { return null; }
  }, [locale]);
  const label = tt(t, 'home.country_label', 'País preferido');

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value || null;
    setCountry(v);
    track('home_country_changed', { country: v ?? 'none', from: variant });
  };
  const options = (
    <>
      <option value="">{tt(t, 'home.country_all', 'Todos los países')}</option>
      {HOME_COUNTRIES.map((c) => (
        <option key={c} value={c}>{names?.of(c) ?? c}</option>
      ))}
    </>
  );

  if (variant === 'field') {
    return (
      <select aria-label={label} value={country ?? ''} onChange={onChange}
              className="min-h-[44px] max-w-[10.5rem] shrink-0 truncate rounded-xl border border-slate-200 bg-white pl-3 pr-8 text-sm text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:ring-rink-accent">
        {options}
      </select>
    );
  }

  // Chip de la home (04/11/2026): compacto, con icono y flecha propios. Sin el
  // anillo granate de foco, que en Android se quedaba puesto tras tocarlo: el
  // foco se marca con el borde (también con teclado).
  return (
    <label className="relative inline-flex h-9 shrink-0 items-center rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-700 transition-colors focus-within:border-slate-500 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus-within:border-slate-400">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
           className="pointer-events-none absolute left-3 h-4 w-4 text-slate-500 dark:text-slate-400">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
      <select aria-label={label} value={country ?? ''} onChange={onChange}
              className="h-full cursor-pointer appearance-none rounded-full bg-transparent pl-9 pr-8 focus:outline-none">
        {options}
      </select>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
           className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-slate-500 dark:text-slate-400">
        <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}
