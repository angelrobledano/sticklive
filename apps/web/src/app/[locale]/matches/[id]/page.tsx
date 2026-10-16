import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getMatchDetail, isApiNotFound } from '@/lib/api/client';
import { MatchCenterClient } from '@/components/match/MatchCenterClient';
import { BackLink } from '@/components/shared/BackLink';
import { JsonLd } from '@/components/shared/JsonLd';
import { localeAlternates, socialMeta, isSupportedLocale, SITE_URL, metadataOnError } from '@/lib/seo';
import { teamTitleName } from '@/lib/names';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

const DESC: Record<string, (h: string, a: string) => string> = {
  es: (h, a) => `Resultado, goles, alineaciones y estadísticas del ${h} - ${a} de hockey patines, en directo en Stick Live.`,
  en: (h, a) => `${h} vs ${a} rink hockey: live score, goals, lineups and stats on Stick Live.`,
  pt: (h, a) => `${h} - ${a} de hóquei em patins: resultado, golos, onzes e estatísticas em direto no Stick Live.`,
  fr: (h, a) => `${h} - ${a} de rink hockey : score en direct, buts, compositions et statistiques sur Stick Live.`,
  it: (h, a) => `${h} - ${a} di hockey su pista: risultato in diretta, gol, formazioni e statistiche su Stick Live.`,
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  const alternates = localeAlternates(locale, `/matches/${params.id}`);
  try {
    const data = await getMatchDetail(params.id);
    // #338: nombre completo (no el shortName, que clubName() convertiría en
    // "Cpah"); sin nombre completo se conserva la sigla tal cual.
    const home = teamTitleName(data.match.homeTeam?.name, data.match.homeTeam?.shortName);
    const away = teamTitleName(data.match.awayTeam?.name, data.match.awayTeam?.shortName);
    const showScore = data.match.status === 'finished' || data.match.status === 'live';
    const score = showScore ? ` ${data.match.score.home ?? 0}-${data.match.score.away ?? 0} ` : ' - ';
    const ogTitle = `${home}${score}${away}`;
    const title = `${ogTitle} | Stick Live`;
    const description = (DESC[locale] ?? DESC['en'])!(home, away);
    return {
      title,
      description,
      alternates,
      ...socialMeta({ locale, path: `/matches/${params.id}`, title: ogTitle, description, dynamicImage: true }),
    };
  } catch (err) {
    return metadataOnError(err, alternates);
  }
}

export default async function MatchDetailPage(props: Props) {
  const params = await props.params;
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
    name: `${teamTitleName(m.homeTeam?.name, m.homeTeam?.shortName)} vs ${teamTitleName(m.awayTeam?.name, m.awayTeam?.shortName)}`,
    sport: 'Roller Hockey',
    startDate: m.scheduledAt ?? undefined,
    // schema.org no tiene un estado "finalizado": para un partido terminado se
    // omite eventStatus (omitirlo es correcto; EventScheduled sería erróneo).
    eventStatus: m.status === 'finished'
      ? undefined
      : m.status === 'postponed'
        ? 'https://schema.org/EventPostponed'
        : m.status === 'cancelled'
          ? 'https://schema.org/EventCancelled'
          : 'https://schema.org/EventScheduled',
    location: m.venue?.name
      ? { '@type': 'Place', name: m.venue.name, address: m.venue.city ?? undefined }
      : undefined,
    competitor: [
      { '@type': 'SportsTeam', name: teamTitleName(m.homeTeam?.name, m.homeTeam?.shortName), url: `${SITE_URL}/${params.locale}/teams/${m.homeTeam?.id}` },
      { '@type': 'SportsTeam', name: teamTitleName(m.awayTeam?.name, m.awayTeam?.shortName), url: `${SITE_URL}/${params.locale}/teams/${m.awayTeam?.id}` },
    ],
  };

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">
      <JsonLd data={jsonLd} />

      {/* Navegacion de vuelta: el fallback es la competición del partido (#182) */}
      <BackLink href={m.competitionId ? `/competitions/${m.competitionId}` : '/'} />

      {/* Match Center */}
      <MatchCenterClient data={data} />
    </div>
  );
}
