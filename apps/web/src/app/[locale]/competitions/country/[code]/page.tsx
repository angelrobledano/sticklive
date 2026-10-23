import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCompetitions, getFederations, type Federation } from '@/lib/api/client';
import { CompetitionHub } from '@/components/competition/CompetitionHub';
import { JsonLd } from '@/components/shared/JsonLd';
import { localeAlternates, socialMeta, isSupportedLocale, competitionsListJsonLd, SITE_URL } from '@/lib/seo';
import { competitionName } from '@/lib/names';
import { countryHubCompetitions } from '@/lib/competition-hubs';
import { countryHubPath } from '@/lib/competition-groups';

export const revalidate = 300;

type Props = { params: Promise<{ locale: string; code: string }> };

function countryName(code: string, locale: string): string {
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase()) ?? code; }
  catch { return code; }
}

const TITLE: Record<string, (c: string) => string> = {
  es: (c) => `Hockey patines en ${c}: ligas y competiciones`,
  en: (c) => `Rink hockey in ${c}: leagues and competitions`,
  pt: (c) => `Hóquei em patins em ${c}: ligas e competições`,
  fr: (c) => `Rink hockey en ${c} : ligues et compétitions`,
  it: (c) => `Hockey su pista in ${c}: campionati e competizioni`,
};
const DESC: Record<string, (c: string) => string> = {
  es: (c) => `Resultados, calendarios y clasificaciones de todas las ligas, copas y categorías de base de ${c}.`,
  en: (c) => `Results, fixtures and standings for every league, cup and youth category in ${c}.`,
  pt: (c) => `Resultados, calendários e classificações de todas as ligas, taças e escalões de formação em ${c}.`,
  fr: (c) => `Résultats, calendriers et classements de toutes les ligues, coupes et catégories jeunes en ${c}.`,
  it: (c) => `Risultati, calendari e classifiche di tutti i campionati, coppe e categorie giovanili in ${c}.`,
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale: raw, code } = await props.params;
  const locale = isSupportedLocale(raw) ? raw : 'en';
  const name = countryName(code, locale);
  const title = (TITLE[locale] ?? TITLE.en!)(name);
  const description = (DESC[locale] ?? DESC.en!)(name);
  const path = countryHubPath(code);
  return {
    title: `${title} | Stick Live`,
    description,
    alternates: localeAlternates(locale, path),
    ...socialMeta({ locale, path, title, description }),
  };
}

export default async function CountryHubPage(props: Props) {
  const { locale: raw, code } = await props.params;
  const locale = isSupportedLocale(raw) ? raw : 'en';
  if (!/^[a-z]{2}$/i.test(code)) notFound();

  const [all, federations] = await Promise.all([
    getCompetitions(),
    getFederations().catch((): Federation[] => []),
  ]);
  const comps = countryHubCompetitions(all, code);
  if (comps.length === 0) notFound();

  const cc = code.toUpperCase();
  const national = federations.find((f) => f.level === 'national' && f.country?.toUpperCase() === cc);

  return (
    <>
      <JsonLd data={competitionsListJsonLd(comps.map((c) => ({
        name: competitionName(c.name, c.nameI18n, locale),
        url: `${SITE_URL}/${locale}/competitions/${c.id}`,
      })))} />
      <CompetitionHub
        title={countryName(code, locale)}
        subtitle={national?.name ?? null}
        countryCode={cc}
        competitions={comps}
        federations={federations}
        website={national?.website ?? null}
      />
    </>
  );
}
