'use client';

import { useMemo, useState } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import type { CompetitionSummary } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';
import { CountryFlag } from '@/components/shared/CountryFlag';
import { competitionName, clubName } from '@/lib/names';
import { competitionPath } from '@/lib/competition-path';
import { usePreferredCountry } from '@/hooks/usePreferredCountry';
import {
  buildCompetitionsHome, competitionStatus, groupVariants,
} from '@/lib/competitions-home';
import { CompetitionRow } from './CompetitionsList';

/** Estado corto de una competición (ver `competitionStatus`) ya traducido. */
function useStatusLine() {
  const { t, locale } = useT();
  const fmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }), [locale]);
  return (c: CompetitionSummary): { text: string; live: boolean } | null => {
    const st = competitionStatus(c);
    if (!st) return null;
    switch (st.kind) {
      case 'live': {
        const live = tt(t, 'competitions.live_n', '{n} en juego', { n: st.live });
        const md = st.matchday != null ? ` · ${tt(t, 'competitions.matchday_n', 'Jornada {n}', { n: st.matchday })}` : '';
        return { text: live + md, live: true };
      }
      case 'champion': return { text: `🏆 ${clubName(st.team.name)}`, live: false };
      case 'matchday': return { text: tt(t, 'competitions.matchday_of', 'Jornada {c} de {t}', { c: st.current, t: st.total }), live: false };
      case 'next': return { text: tt(t, 'competitions.next_on', 'Próximo: {d}', { d: fmt.format(new Date(st.at)) }), live: false };
      case 'last': return { text: tt(t, 'competitions.last_on', 'Último: {d}', { d: fmt.format(new Date(st.at)) }), live: false };
    }
  };
}

function StatusLine({ status }: { status: { text: string; live: boolean } | null }) {
  if (!status) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${status.live ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
      {status.live && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />}
      <span>{status.text}</span>
    </span>
  );
}

function Logo({ comp, size }: { comp: CompetitionSummary; size: number }) {
  if (comp.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={comp.logoUrl} alt="" width={size} height={size} loading="lazy"
           className="shrink-0 rounded-full border border-slate-200 bg-white object-contain p-1 dark:border-slate-700"
           style={{ width: size, height: size }} />
    );
  }
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-rink-passion/10 text-xs font-bold text-rink-passion"
          style={{ width: size, height: size }} aria-hidden="true">
      {(comp.shortName ?? comp.name).slice(0, 2).toUpperCase()}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="px-1 pb-2 pt-4 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{children}</h2>;
}

/** Tarjeta grande de las competiciones principales: logo visible, un clic. */
function BigCard({ comp }: { comp: CompetitionSummary }) {
  const { locale } = useT();
  const status = useStatusLine()(comp);
  return (
    <Link
      href={competitionPath(comp.id, comp.slug)}
      className="card flex min-h-[112px] flex-col gap-2 border border-slate-200 p-3 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-slate-700 dark:hover:bg-slate-800/50"
    >
      <div className="flex items-center justify-between gap-2">
        <Logo comp={comp} size={44} />
        {comp.country && comp.country.length === 2 && <CountryFlag code={comp.country} className="h-3 w-[18px] rounded-[2px]" />}
      </div>
      <span className="line-clamp-2 text-[13px] font-bold leading-tight text-slate-900 dark:text-slate-50">
        {clubName(competitionName(comp.name, comp.nameI18n, locale))}
      </span>
      <StatusLine status={status} />
    </Link>
  );
}

export function FeaturedCompetitions({ comps, favorites, onToggleFav }: {
  /** Competiciones ya filtradas por género. */
  comps: CompetitionSummary[];
  favorites: Set<string>;
  onToggleFav: (id: string) => void;
}) {
  const { t, locale } = useT();
  const statusOf = useStatusLine();
  const home = useMemo(() => buildCompetitionsHome(comps), [comps]);

  const { country: preferred } = usePreferredCountry();
  const withData = home.secondCountries;
  const initial = withData.find((k) => k === preferred) ?? withData[0] ?? 'ES';
  const [picked, setPicked] = useState<string | null>(null);
  const country = picked && withData.includes(picked) ? picked : initial;
  const rows = useMemo(() => groupVariants(home.second[country] ?? []), [home, country]);

  const countryName = (code: string) => {
    try { return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code; } catch { return code; }
  };

  return (
    <div>
      {home.big.length > 0 && (
        <section>
          <SectionTitle>{tt(t, 'competitions.section_main', 'Principales')}</SectionTitle>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {home.big.map((c) => <BigCard key={c.id} comp={c} />)}
          </div>
        </section>
      )}

      {home.cups.length > 0 && (
        <section>
          <SectionTitle>{tt(t, 'competitions.section_cups_now', 'Copas y torneos')}</SectionTitle>
          {home.cups.map((c) => (
            <CompetitionRow key={c.id} comp={c} isFav={favorites.has(c.id)} onToggleFav={onToggleFav} locale={locale} status={statusOf(c)} />
          ))}
        </section>
      )}

      {withData.length > 0 && (
        <section>
          <SectionTitle>{tt(t, 'competitions.section_second', 'Más ligas nacionales')}</SectionTitle>
          <div className="mb-1 flex gap-1.5" role="group" aria-label={tt(t, 'competitions.section_second', 'Más ligas nacionales')}>
            {withData.map((k) => (
              <button
                key={k}
                onClick={() => setPicked(k)}
                aria-pressed={country === k}
                className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-colors ${
                  country === k
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                <CountryFlag code={k} className="h-2.5 w-[15px] rounded-[2px]" />
                {countryName(k)}
              </button>
            ))}
          </div>
          {rows.map((r) => (r.variants.length === 0 ? (
            <CompetitionRow key={r.main.id} comp={r.main} isFav={favorites.has(r.main.id)} onToggleFav={onToggleFav} locale={locale} status={statusOf(r.main)} />
          ) : (
            <div key={r.main.id} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5">
              <Logo comp={r.main} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                  {clubName(competitionName(r.label, null, locale))}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {r.variants.map((v) => (
                    <Link
                      key={v.comp.id}
                      href={competitionPath(v.comp.id, v.comp.slug)}
                      className="inline-flex min-h-[28px] items-center rounded-lg border border-slate-200 px-2.5 text-[12px] font-semibold text-slate-700 transition-colors hover:border-rink-passion hover:text-rink-passion dark:border-slate-700 dark:text-slate-200"
                    >
                      {v.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )))}
        </section>
      )}
    </div>
  );
}
