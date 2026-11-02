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

  const cls = variant === 'chip'
    ? 'min-h-[36px] rounded-full border border-slate-200 bg-white pl-3 pr-8 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
    : 'min-h-[44px] max-w-[10.5rem] truncate rounded-xl border border-slate-200 bg-white pl-3 pr-8 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

  return (
    <select
      aria-label={label}
      value={country ?? ''}
      onChange={(e) => {
        const v = e.target.value || null;
        setCountry(v);
        track('home_country_changed', { country: v ?? 'none', from: variant });
      }}
      className={`${cls} shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent`}
    >
      <option value="">{tt(t, 'home.country_all', 'Todos los países')}</option>
      {HOME_COUNTRIES.map((c) => (
        <option key={c} value={c}>{names?.of(c) ?? c}</option>
      ))}
    </select>
  );
}
