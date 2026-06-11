import type { Metadata } from 'next';
import { getCompetitions } from '@/lib/api/client';
import { CompetitionsList } from '@/components/competition/CompetitionsList';
import { localeAlternates, isSupportedLocale } from '@/lib/seo';

const TITLES: Record<string, string> = {
  es: 'Competiciones · Stick Live',
  en: 'Competitions · Stick Live',
  pt: 'Competições · Stick Live',
  fr: 'Compétitions · Stick Live',
  it: 'Competizioni · Stick Live',
};

export function generateMetadata({ params }: { params: { locale: string } }): Metadata {
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  return {
    title: TITLES[locale],
    alternates: localeAlternates(locale, '/competitions'),
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
