import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getMatchDetail, isApiNotFound } from '@/lib/api/client';
import { MatchCenterClient } from '@/components/match/MatchCenterClient';
import { BackLink } from '@/components/shared/BackLink';
import { localeAlternates, isSupportedLocale } from '@/lib/seo';

interface Props {
  params: { locale: string; id: string };
}

export function generateMetadata({ params }: Props): Metadata {
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  return { alternates: localeAlternates(locale, `/matches/${params.id}`) };
}

export default async function MatchDetailPage({ params }: Props) {
  const matchId = params.id;
  let data;
  try {
    data = await getMatchDetail(matchId);
  } catch (err) {
    console.error(`[MatchDetailPage] getMatchDetail("${matchId}") fallo:`, err);
    if (isApiNotFound(err)) notFound();
    throw err; // error boundary con reintento — la API puede estar reiniciándose
  }


  // DIAG: volcar estructura recibida del API en los logs del servidor Next.js
  console.log('[MatchDetailPage] data received for', matchId, {
    matchId:        data?.match?.id,
    status:         data?.match?.status,
    hasHomeTeam:    !!data?.match?.homeTeam,
    hasAwayTeam:    !!data?.match?.awayTeam,
    homeTeamKeys:   data?.match?.homeTeam ? Object.keys(data.match.homeTeam) : [],
    eventsCount:    data?.events?.length ?? 'undefined',
    statsKeys:      data?.stats ? Object.keys(data.stats) : [],
    homeFouls:      data?.stats?.homeFouls,
    awayFouls:      data?.stats?.awayFouls,
    // Primer evento (si existe) para ver si los keys son camelCase o snake_case
    firstEventKeys: data?.events?.[0] ? Object.keys(data.events[0]) : [],
  });

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">
      {/* Navegacion de vuelta */}
      <BackLink href="/" />

      {/* Match Center */}
      <MatchCenterClient data={data!} />
    </div>
  );
}
