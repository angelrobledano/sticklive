import type { Metadata } from 'next';
import { getCompetitions } from '@/lib/api/client';
import { CompetitionsList } from '@/components/competition/CompetitionsList';
import { localeAlternates, socialMeta, isSupportedLocale } from '@/lib/seo';

const TITLES: Record<string, string> = {
  es: 'Competiciones · Stick Live',
  en: 'Competitions · Stick Live',
  pt: 'Competições · Stick Live',
  fr: 'Compétitions · Stick Live',
  it: 'Competizioni · Stick Live',
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
    alternates: localeAlternates(locale, '/competitions'),
    ...socialMeta({
      locale,
      path: '/competitions',
      title: OG_TITLES[locale] ?? OG_TITLES['en']!,
      description: OG_DESCRIPTIONS[locale] ?? OG_DESCRIPTIONS['en']!,
    }),
  };
}

export default async function CompetitionsPage() {
  let competitions: Awaited<ReturnType<typeof getCompetitions>> = [];
  let fetchError: string | null = null;

  try {
    competitions = await getCompetitions();
  } catch (err) {
    fetchError = err instanceof Error ? err.message : 'API error';
  }

  return <CompetitionsList competitions={competitions} error={fetchError} />;
}
