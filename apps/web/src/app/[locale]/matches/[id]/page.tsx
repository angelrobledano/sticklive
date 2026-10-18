import type { Metadata } from 'next';
import { getMatchDetail, isApiNotFound } from '@/lib/api/client';
import { MatchCenterClient } from '@/components/match/MatchCenterClient';
import { BackLink } from '@/components/shared/BackLink';
import { JsonLd } from '@/components/shared/JsonLd';
import { redirectOrNotFound } from '@/lib/entity-redirect';
import {
  localeAlternates,
  breadcrumbJsonLd,
  matchMetaDescription,
  matchMetaTitle,
  socialMeta,
  isSupportedLocale,
  SITE_URL,
  metadataOnError,
} from '@/lib/seo';
import { teamTitleName } from '@/lib/names';
import { BREADCRUMB_LABELS } from '@/lib/breadcrumbs';
import { Breadcrumbs } from '@/components/shared/Breadcrumbs';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

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
    const showOgScore = data.match.status === 'finished' || data.match.status === 'live';
    const ogScore = showOgScore
      ? ` ${data.match.score.home ?? 0}-${data.match.score.away ?? 0} `
      : ' - ';
    const ogTitle = `${home}${ogScore}${away}`;
    const metaInput = {
      locale,
      home,
      away,
      status: data.match.status,
      score: data.match.score,
      scheduledAt: data.match.scheduledAt,
    };
    const title = matchMetaTitle(metaInput);
    const description = matchMetaDescription(metaInput);
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
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  let data;
  try {
    data = await getMatchDetail(matchId);
  } catch (err) {
    // F1-7: si la ficha se fusionó o la sustituye otra, 308 a esa ficha.
    if (isApiNotFound(err)) {
      await redirectOrNotFound('match', params.id, isSupportedLocale(params.locale) ? params.locale : 'en');
    }
    throw err; // error boundary con reintento — la API puede estar reiniciándose
  }

  // schema.org SportsEvent — resultados enriquecidos en buscadores
  const m = data.match;

  // F5-6: migas visibles + BreadcrumbList (Inicio › Competiciones › Competición › Partido).
  const homeName = teamTitleName(m.homeTeam?.name, m.homeTeam?.shortName);
  const awayName = teamTitleName(m.awayTeam?.name, m.awayTeam?.shortName);
  const crumbs = [
    { label: BREADCRUMB_LABELS[locale].home, href: '/' },
    { label: BREADCRUMB_LABELS[locale].competitions, href: '/competitions' },
    ...(m.competitionName && m.competitionId
      ? [{ label: m.competitionName, href: `/competitions/${m.competitionId}` }]
      : []),
    { label: `${homeName} - ${awayName}`, href: `/matches/${m.id}` },
  ];
  const breadcrumbLd = breadcrumbJsonLd(
    locale,
    crumbs.map(({ label, href }) => ({ name: label, path: href })),
  );
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
      <JsonLd data={breadcrumbLd} />

      {/* Navegacion de vuelta: el fallback es la competición del partido (#182) */}
      <BackLink href={m.competitionId ? `/competitions/${m.competitionId}` : '/'} />
      <Breadcrumbs items={crumbs} />

      {/* Match Center */}
      <MatchCenterClient data={data} />
    </div>
  );
}
