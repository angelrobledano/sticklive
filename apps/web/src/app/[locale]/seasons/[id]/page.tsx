import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import {
  getSeasonOverview,
  getSeasonStats,
  getSeasonInsights,
  getCompetitionSeasons,
  isApiNotFound,
  type SeasonInsights,
  type SeasonStats,
} from '@/lib/api/client';
import type { SeasonOverview } from '@/lib/api/types';
import { buildCompetitionSummary } from '@/lib/content-summary';
import { CompetitionSummary } from '@/components/competition/CompetitionSummary';
import { ClosedSeasonHighlights } from '@/components/competition/ClosedSeasonHighlights';
import { ClosedSeasonStandings } from '@/components/competition/ClosedSeasonStandings';
import { BackLink } from '@/components/shared/BackLink';
import { JsonLd } from '@/components/shared/JsonLd';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { Breadcrumbs } from '@/components/shared/Breadcrumbs';
import { BREADCRUMB_LABELS } from '@/lib/breadcrumbs';
import {
  SITE_URL,
  competitionJsonLd,
  isSupportedLocale,
  localeAlternates,
  metadataOnError,
  socialMeta,
} from '@/lib/seo';
import { clubName } from '@/lib/names';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

const PENDING = new Set(['scheduled', 'live', 'halftime', 'overtime', 'penalty_shootout']);

const COPY: Record<string, {
  title: (competition: string, season: string) => string;
  description: (competition: string, season: string) => string;
  currentSeason: string;
  calendar: string;
}> = {
  es: {
    title: (c, s) => `Así terminó ${c}${s ? ` ${s}` : ''}`,
    description: (c, s) => `Clasificación final, campeón, goleadores y récords de ${c}${s ? ` ${s}` : ''}.`,
    currentSeason: 'Ver la temporada actual',
    calendar: 'Calendario y actas',
  },
  en: {
    title: (c, s) => `How ${c}${s ? ` ${s}` : ''} ended`,
    description: (c, s) => `Final standings, champion, top scorers and records from ${c}${s ? ` ${s}` : ''}.`,
    currentSeason: 'View the current season',
    calendar: 'Fixtures and match sheets',
  },
  pt: {
    title: (c, s) => `Assim terminou ${c}${s ? ` ${s}` : ''}`,
    description: (c, s) => `Classificação final, campeão, marcadores e recordes de ${c}${s ? ` ${s}` : ''}.`,
    currentSeason: 'Ver a temporada atual',
    calendar: 'Calendário e fichas',
  },
  fr: {
    title: (c, s) => `Bilan de ${c}${s ? ` ${s}` : ''}`,
    description: (c, s) => `Classement final, champion, buteurs et records de ${c}${s ? ` ${s}` : ''}.`,
    currentSeason: 'Voir la saison en cours',
    calendar: 'Calendrier et feuilles de match',
  },
  it: {
    title: (c, s) => `Com’è finita ${c}${s ? ` ${s}` : ''}`,
    description: (c, s) => `Classifica finale, campione, marcatori e record di ${c}${s ? ` ${s}` : ''}.`,
    currentSeason: 'Vedi la stagione attuale',
    calendar: 'Calendario e referti',
  },
};

function isClosed(overview: SeasonOverview): boolean {
  return overview.matches.some((m) => m.status === 'finished')
    && !overview.matches.some((m) => PENDING.has(m.status));
}

async function load(seasonId: string): Promise<{ overview: SeasonOverview; stats: SeasonStats | null; insights: SeasonInsights | null }> {
  const overview = await getSeasonOverview(seasonId);
  const [stats, insights] = await Promise.all([
    getSeasonStats(seasonId).catch(() => null),
    getSeasonInsights(seasonId).catch(() => null),
  ]);
  return { overview, stats, insights };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale: rawLocale, id } = await props.params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : 'en';
  const alternates = localeAlternates(locale, `/seasons/${id}`);
  try {
    const { overview } = await load(id);
    const c = COPY[locale] ?? COPY['en']!;
    const name = overview.season.competitionName;
    const season = overview.season.name ?? '';
    const title = c.title(name, season);
    const description = c.description(name, season);
    return {
      title: `${title} | Stick Live`,
      description,
      alternates,
      ...socialMeta({ locale, path: `/seasons/${id}`, title, description, dynamicImage: false }),
    };
  } catch (err) {
    return metadataOnError(err, alternates);
  }
}

export default async function ClosedSeasonPage(props: Props) {
  const { locale: rawLocale, id } = await props.params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : 'en';
  const c = COPY[locale] ?? COPY['en']!;

  let data: Awaited<ReturnType<typeof load>>;
  try {
    data = await load(id);
  } catch (err) {
    if (isApiNotFound(err)) notFound();
    throw err;
  }

  const { overview, stats, insights } = data;
  const competitionId = overview.season.competitionId;
  if (!competitionId) notFound();
  if (!isClosed(overview)) {
    redirect(`/${locale}/competitions/${competitionId}?season=${id}`);
  }

  const competitionName = overview.season.competitionName;
  const seasonName = overview.season.name ?? '';
  const summary = buildCompetitionSummary(overview, stats);
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: overview.season.competitionTimezone || 'Europe/Madrid',
  }).format(new Date());

  const current = await getCompetitionSeasons(competitionId)
    .then((seasons) => seasons.find((s) => s.isCurrent && s.id !== id) ?? null)
    .catch(() => null);

  const crumbs = [
    { label: BREADCRUMB_LABELS[locale].home, href: '/' },
    { label: BREADCRUMB_LABELS[locale].competitions, href: '/competitions' },
    { label: competitionName, href: `/competitions/${competitionId}` },
    { label: seasonName || c.title(competitionName, ''), href: `/seasons/${id}` },
  ];
  const ld = competitionJsonLd({
    leagueName: competitionName,
    leagueUrl: `${SITE_URL}/${locale}/seasons/${id}`,
    seasonName,
    startDate: overview.season.startDate,
    endDate: overview.season.endDate,
    country: overview.season.competitionCountry,
  });

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">
      <JsonLd data={ld} />
      <BackLink href={`/competitions/${competitionId}`} />
      <Breadcrumbs items={crumbs} />

      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{clubName(competitionName)}</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-900 dark:text-slate-50">
          {c.title(competitionName, seasonName)}
        </h1>
      </header>

      <CompetitionSummary
        data={summary}
        locale={locale}
        insights={insights}
        seed={id}
        day={day}
      />

      <ClosedSeasonHighlights
        summary={summary}
        stats={stats}
        insights={insights}
        standings={overview.standings}
        locale={locale}
      />

      <ClosedSeasonStandings rows={overview.standings} locale={locale} />

      <div className="flex flex-wrap gap-3 text-sm">
        <Link href={`/competitions/${competitionId}?season=${id}`} className="font-semibold text-rink-passion underline underline-offset-2">
          {c.calendar}
        </Link>
        {current && (
          <Link href={`/competitions/${competitionId}`} className="font-semibold text-rink-passion underline underline-offset-2">
            {c.currentSeason}
          </Link>
        )}
      </div>
    </div>
  );
}
