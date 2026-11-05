import type { Metadata } from 'next';
import { getFeedInRange, getMatchDays } from '@/lib/api/client';
import { madridTodayKey } from '@sports/core/match-time';
import { dayFetchRange } from '@/lib/home-loading';
import { MatchesView, HomeLoadError } from '@/components/shared/MatchesView';
import { localeAlternates, isSupportedLocale } from '@/lib/seo';

// #351: HTML público cacheable en edge. Los datos ya llevan revalidate:60 en
// `lib/api/client.ts` y los directos se refrescan en cliente (useLiveScores),
// así que cachear el HTML 60 s no añade obsolescencia de marcador.
export const revalidate = 60;

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  return { alternates: localeAlternates(locale, '/') };
}

export default async function HomePage() {
  // Solo hoy (plan 2026-10-25, iteración 2): antes se traían 23 días de todo
  // el catálogo (~3.400 partidos, 734 KB de HTML). El resto de días se pide
  // al abrirlos y el índice de días (`/matches/days`) pinta el selector.
  // Solo lo que sale por defecto (spec 2026-10-30): destacadas. Lo seguido y
  // el país se aplican en cliente (viven en el dispositivo).
  let matches: Awaited<ReturnType<typeof getFeedInRange>>['matches'] = [];
  let hidden: Record<string, number> = {};
  let days: Awaited<ReturnType<typeof getMatchDays>> = [];
  let fetchFailed = false;
  const { from, to } = dayFetchRange(madridTodayKey());

  const [mRes, dRes] = await Promise.allSettled([getFeedInRange(from, to), getMatchDays()]);
  if (mRes.status === 'fulfilled') ({ matches, hiddenByHour: hidden } = mRes.value); else fetchFailed = true;
  // El índice es accesorio: si falla, la vista se degrada a los partidos de hoy.
  if (dRes.status === 'fulfilled') days = dRes.value;

  if (fetchFailed) {
    // #346: reintento real + copy i18n (client component).
    return <HomeLoadError />;
  }

  return <MatchesView matches={matches} days={days} hiddenByHour={hidden} />;
}
