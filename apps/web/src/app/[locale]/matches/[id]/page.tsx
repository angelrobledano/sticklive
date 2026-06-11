import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getMatchDetail, isApiNotFound } from '@/lib/api/client';
import { MatchCenterClient } from '@/components/match/MatchCenterClient';
import { BackLink } from '@/components/shared/BackLink';
import { JsonLd } from '@/components/shared/JsonLd';
import { localeAlternates, isSupportedLocale, SITE_URL } from '@/lib/seo';
import { clubName } from '@/lib/names';

interface Props {
  params: { locale: string; id: string };
}

const DESC: Record<string, (h: string, a: string) => string> = {
  es: (h, a) => `Resultado, goles, alineaciones y estadísticas del ${h} - ${a} de hockey patines, en directo en Stick Live.`,
  en: (h, a) => `${h} vs ${a} rink hockey: live score, goals, lineups and stats on Stick Live.`,
  pt: (h, a) => `${h} - ${a} de hóquei em patins: resultado, golos, onzes e estatísticas em direto no Stick Live.`,
  fr: (h, a) => `${h} - ${a} de rink hockey : score en direct, buts, compositions et statistiques sur Stick Live.`,
  it: (h, a) => `${h} - ${a} di hockey su pista: risultato in diretta, gol, formazioni e statistiche su Stick Live.`,
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  const alternates = localeAlternates(locale, `/matches/${params.id}`);
  try {
    const data = await getMatchDetail(params.id);
    const home = clubName(data.match.homeTeam?.shortName ?? data.match.homeTeam?.name ?? '');
    const away = clubName(data.match.awayTeam?.shortName ?? data.match.awayTeam?.name ?? '');
    const finished = data.match.status === 'finished';
    const score = finished ? ` ${data.match.score.home ?? 0}-${data.match.score.away ?? 0} ` : ' - ';
    const title = `${home}${score}${away} | Stick Live`;
    const description = (DESC[locale] ?? DESC['en'])!(home, away);
    return {
      title,
      description,
      alternates,
      openGraph: { title, description, type: 'website' },
    };
  } catch {
    return { alternates };
  }
}

export default async function MatchDetailPage({ params }: Props) {
  const matchId = params.id;
  let data;
  try {
    data = await getMatchDetail(matchId);
  } catch (err) {
    if (isApiNotFound(err)) notFound();
    throw err; // error boundary con reintento — la API puede estar reiniciándose
  }

  // schema.org SportsEvent — resultados enriquecidos en buscadores
  const m = data.match;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: `${clubName(m.homeTeam?.name ?? '')} vs ${clubName(m.awayTeam?.name ?? '')}`,
    sport: 'Roller Hockey',
    startDate: m.scheduledAt ?? undefined,
    eventStatus: m.status === 'finished'
      ? 'https://schema.org/EventScheduled'
      : m.status === 'postponed'
        ? 'https://schema.org/EventPostponed'
        : 'https://schema.org/EventScheduled',
    location: m.venue?.name
      ? { '@type': 'Place', name: m.venue.name, address: m.venue.city ?? undefined }
      : undefined,
    competitor: [
      { '@type': 'SportsTeam', name: clubName(m.homeTeam?.name ?? ''), url: `${SITE_URL}/${params.locale}/teams/${m.homeTeam?.id}` },
      { '@type': 'SportsTeam', name: clubName(m.awayTeam?.name ?? ''), url: `${SITE_URL}/${params.locale}/teams/${m.awayTeam?.id}` },
    ],
  };

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">
      <JsonLd data={jsonLd} />

      {/* Navegacion de vuelta */}
      <BackLink href="/" />

      {/* Match Center */}
      <MatchCenterClient data={data} />
    </div>
  );
}
