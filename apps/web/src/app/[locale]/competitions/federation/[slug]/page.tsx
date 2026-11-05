import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCompetitions, getFederations, getCompetitionsMatches } from '@/lib/api/client';
import { buildFederationOverview, federationIntro } from '@/lib/federation-overview';
import { FederationMatches } from '@/components/competition/FederationMatches';
import { CompetitionHub } from '@/components/competition/CompetitionHub';
import { JsonLd } from '@/components/shared/JsonLd';
import { localeAlternates, socialMeta, isSupportedLocale, competitionsListJsonLd, SITE_URL } from '@/lib/seo';
import { competitionName } from '@sports/core/names';
import { federationHubCompetitions } from '@/lib/competition-hubs';
import { federationHubPath } from '@/lib/competition-groups';
import { competitionPath } from '@/lib/competition-path';

export const revalidate = 300;

type Props = { params: Promise<{ locale: string; slug: string }> };

const DESC: Record<string, (f: string) => string> = {
  es: (f) => `Resultados, calendarios y clasificaciones de las competiciones de hockey patines de la ${f}.`,
  en: (f) => `Results, fixtures and standings for the rink hockey competitions of ${f}.`,
  pt: (f) => `Resultados, calendários e classificações das competições de hóquei em patins da ${f}.`,
  fr: (f) => `Résultats, calendriers et classements des compétitions de rink hockey de la ${f}.`,
  it: (f) => `Risultati, calendari e classifiche delle competizioni di hockey su pista della ${f}.`,
};

async function load(slug: string) {
  const federations = await getFederations();
  const fed = federations.find((f) => f.slug === slug);
  return { federations, fed };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale: raw, slug } = await props.params;
  const locale = isSupportedLocale(raw) ? raw : 'en';
  const { fed } = await load(slug).catch(() => ({ fed: undefined }));
  if (!fed) return {};
  const title = `${fed.name} (${fed.shortName})`;
  const description = (DESC[locale] ?? DESC.en!)(fed.name);
  const path = federationHubPath(fed.slug);
  return {
    title: `${title} | Stick Live`,
    description,
    alternates: localeAlternates(locale, path),
    ...socialMeta({ locale, path, title, description }),
  };
}

export default async function FederationHubPage(props: Props) {
  const { locale: raw, slug } = await props.params;
  const locale = isSupportedLocale(raw) ? raw : 'en';
  const [{ federations, fed }, all] = await Promise.all([load(slug), getCompetitions()]);
  if (!fed) notFound();
  const comps = federationHubCompetitions(all, fed, federations);
  if (comps.length === 0) notFound();
  // Últimos resultados y próximos partidos: dos semanas a cada lado de hoy.
  const day = 86_400_000;
  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const matches = await getCompetitionsMatches(comps.map((c) => c.id), iso(now - 14 * day), iso(now + 14 * day)).catch(() => []);
  const overview = buildFederationOverview(comps, matches);

  return (
    <>
      <JsonLd data={competitionsListJsonLd(comps.map((c) => ({
        name: competitionName(c.name, c.nameI18n, locale),
        url: `${SITE_URL}/${locale}${competitionPath(c.id, c.slug)}`,
      })))} />
      <CompetitionHub
        title={fed.name}
        subtitle={fed.region ?? fed.shortName}
        countryCode={fed.country}
        competitions={comps}
        federations={federations}
        website={fed.website}
        intro={federationIntro(overview, `${fed.name} (${fed.shortName})`, locale)}
      >
        <FederationMatches live={overview.live} upcoming={overview.upcoming} results={overview.results} />
      </CompetitionHub>
    </>
  );
}
