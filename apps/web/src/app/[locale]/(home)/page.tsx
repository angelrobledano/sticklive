import type { Metadata } from 'next';
import { getCurrentMatches } from '@/lib/api/client';
import { MatchesView, HomeLoadError } from '@/components/shared/MatchesView';
import { localeAlternates, isSupportedLocale } from '@/lib/seo';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  return { alternates: localeAlternates(locale, '/') };
}

export default async function HomePage() {
  let matches: Awaited<ReturnType<typeof getCurrentMatches>> = [];
  let fetchFailed = false;

  try {
    matches = await getCurrentMatches();
  } catch {
    fetchFailed = true;
  }

  if (fetchFailed) {
    // #346: reintento real + copy i18n (client component).
    return <HomeLoadError />;
  }

  return <MatchesView matches={matches} />;
}
