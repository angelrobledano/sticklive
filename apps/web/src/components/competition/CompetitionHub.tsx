'use client';

import { useMemo } from 'react';
import type { CompetitionSummary, Federation } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { useFavorites } from '@/hooks/useFavorites';
import { CountryFlag } from '@/components/shared/CountryFlag';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { tt } from '@/components/search/translate';
import { buildCountrySections } from '@/lib/competition-groups';
import { CountrySectionsView } from './CompetitionsList';

/**
 * Hub de país o de federación: misma presentación por secciones que el
 * acordeón del listado, con las autonómicas desplegadas.
 */
export function CompetitionHub({
  title,
  subtitle,
  countryCode,
  competitions,
  federations,
  website,
}: {
  title: string;
  subtitle?: string | null;
  countryCode?: string | null;
  competitions: CompetitionSummary[];
  federations: Federation[];
  website?: string | null;
}) {
  const { t, locale } = useT();
  const { leagues, toggleLeague } = useFavorites();
  const favorites = useMemo(() => new Set(leagues), [leagues]);
  const sections = useMemo(
    () => buildCountrySections(competitions, locale, federations),
    [competitions, locale, federations],
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      <Link href="/competitions" className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 hover:underline">
        ← {t('navigation.competitions')}
      </Link>
      <div className="flex items-center gap-3 mt-3 mb-4">
        {countryCode && <CountryFlag code={countryCode} className="w-8 h-auto rounded-[3px] shrink-0" />}
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 truncate">{title}</h1>
          {subtitle && <p className="text-[12px] text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
      </div>
      <p className="px-1 pb-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
        {tt(t, 'competitions.hub_count', '{n} competiciones', { n: competitions.length })}
        {website && (
          <>
            {' · '}
            <a href={website} rel="noopener nofollow" target="_blank" className="hover:underline">
              {tt(t, 'competitions.official_site', 'Web oficial')}
            </a>
          </>
        )}
      </p>
      <CountrySectionsView
        sections={sections}
        favorites={favorites}
        onToggleFav={toggleLeague}
        locale={locale}
        regionalCollapsed={false}
      />
    </div>
  );
}
