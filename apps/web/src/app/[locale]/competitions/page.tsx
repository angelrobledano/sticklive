import type { Metadata } from 'next';
import { getCompetitions, getFederations, type Federation } from '@/lib/api/client';
import { CompetitionsList } from '@/components/competition/CompetitionsList';
import { JsonLd } from '@/components/shared/JsonLd';
import { localeAlternates, socialMeta, isSupportedLocale, competitionsListJsonLd, SITE_URL } from '@/lib/seo';
import { competitionName } from '@/lib/names';

// #351: listado público; los datos ya se revalidan cada 300 s en
// `lib/api/client.ts`, por lo que el HTML hereda ese ISR.
export const revalidate = 300;

const TITLES: Record<string, string> = {
  es: 'Competiciones | Stick Live',
  en: 'Competitions | Stick Live',
  pt: 'Competições | Stick Live',
  fr: 'Compétitions | Stick Live',
  it: 'Competizioni | Stick Live',
};

// OG propio: sin esto, Next hereda el del layout (home) y el preview de
// /competitions anunciaba "Stick Live — hockey en directo" con og:url del home (#367).
const OG_TITLES: Record<string, string> = {
  es: 'Competiciones de hockey patines',
  en: 'Rink hockey competitions',
  pt: 'Competições de hóquei em patins',
  fr: 'Compétitions de rink hockey',
  it: 'Competizioni di hockey su pista',
};
const OG_DESCRIPTIONS: Record<string, string> = {
  es: 'Calendarios, clasificaciones y resultados de todas las competiciones en Stick Live.',
  en: 'Fixtures, standings and results for every competition on Stick Live.',
  pt: 'Calendários, classificações e resultados de todas as competições no Stick Live.',
  fr: 'Calendriers, classements et résultats de toutes les compétitions sur Stick Live.',
  it: 'Calendari, classifiche e risultati di tutte le competizioni su Stick Live.',
};

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  return {
    title: TITLES[locale],
    // F3-7: description propia; sin esto heredaba la de la home (SEO-05).
    description: OG_DESCRIPTIONS[locale] ?? OG_DESCRIPTIONS['en']!,
    alternates: localeAlternates(locale, '/competitions'),
    ...socialMeta({
      locale,
      path: '/competitions',
      title: OG_TITLES[locale] ?? OG_TITLES['en']!,
      description: OG_DESCRIPTIONS[locale] ?? OG_DESCRIPTIONS['en']!,
    }),
  };
}

export default async function CompetitionsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  let competitions: Awaited<ReturnType<typeof getCompetitions>> = [];
  let fetchError: string | null = null;

  let federations: Federation[] = [];

  // Las federaciones solo ordenan países/autonómicas: si fallan, el listado sale igual.
  const [compsRes, fedsRes] = await Promise.allSettled([getCompetitions(), getFederations()]);
  if (compsRes.status === 'fulfilled') competitions = compsRes.value;
  else fetchError = compsRes.reason instanceof Error ? compsRes.reason.message : 'API error';
  if (fedsRes.status === 'fulfilled') federations = fedsRes.value;

  return (
    <>
      {/* #349: ItemList del listado (la lista no tenía structured data) */}
      {competitions.length > 0 && (
        <JsonLd data={competitionsListJsonLd(competitions.map((c) => ({
          name: competitionName(c.name, c.nameI18n, locale),
          url: `${SITE_URL}/${locale}/competitions/${c.id}`,
        })))} />
      )}
      <CompetitionsList competitions={competitions} federations={federations} error={fetchError} />
    </>
  );
}
