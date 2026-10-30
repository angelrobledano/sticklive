'use client';

import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';
import { federationHubPath, type FederationGroup } from '@/lib/competition-groups';

/**
 * Federaciones autonómicas a un toque (30/10/2026): rejilla con la comunidad
 * (como se busca: «Cataluña», «Galicia»), las siglas y cuántas competiciones
 * tiene. Lleva a la página de la federación, que lista todo su catálogo.
 * Las regiones sin federación dada de alta no salen aquí (siguen en Países).
 */
export function FederationGrid({ groups, title }: { groups: FederationGroup[]; title?: string }) {
  const { t } = useT();
  const withFed = groups.filter((g) => g.federation);
  if (withFed.length === 0) return null;
  return (
    <section>
      <h2 className="px-1 pb-2 pt-4 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {title ?? tt(t, 'competitions.section_regional', 'Federaciones autonómicas')}
      </h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {withFed.map((g) => (
          <li key={g.key}>
            <Link
              href={federationHubPath(g.federation!.slug)}
              className="flex min-h-[56px] flex-col justify-center rounded-xl border border-slate-200 px-3 py-2 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800/60"
            >
              <span className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                {g.federation!.region ?? g.label}
              </span>
              <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {g.federation!.shortName} · {tt(t, 'competitions.hub_count', '{n} competiciones', { n: g.comps.length })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
