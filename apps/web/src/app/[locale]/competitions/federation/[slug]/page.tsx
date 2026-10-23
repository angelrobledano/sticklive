import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCompetitions, getFederations } from '@/lib/api/client';
import { CompetitionHub } from '@/components/competition/CompetitionHub';
import { JsonLd } from '@/components/shared/JsonLd';
import { localeAlternates, socialMeta, isSupportedLocale, competitionsListJsonLd, SITE_URL } from '@/lib/seo';
import { competitionName } from '@/lib/names';
import { federationHubCompetitions } from '@/lib/competition-hubs';
import { federationHubPath } from '@/lib/competition-groups';

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

  return (
    <>
      <JsonLd data={competitionsListJsonLd(comps.map((c) => ({
        name: competitionName(c.name, c.nameI18n, locale),
        url: `${SITE_URL}/${locale}/competitions/${c.id}`,
      })))} />
      <CompetitionHub
        title={fed.name}
        subtitle={fed.region ?? fed.shortName}
        countryCode={fed.country}
        competitions={comps}
        federations={federations}
        website={fed.website}
      />
    </>
  );
}
