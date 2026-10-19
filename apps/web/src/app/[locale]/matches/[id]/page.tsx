import type { Metadata } from 'next';
import { getMatchDetail, getSeasonOverview, isApiNotFound } from '@/lib/api/client';
import { MatchCenterClient } from '@/components/match/MatchCenterClient';
import { MatchPreview } from '@/components/match/MatchPreview';
import { MatchChronicle } from '@/components/match/MatchChronicle';
import { buildMatchPreview } from '@/lib/content-summary';
import { buildMatchChronicle } from '@/lib/match-chronicle';
import { BackLink } from '@/components/shared/BackLink';
import { JsonLd } from '@/components/shared/JsonLd';
import { redirectOrNotFound } from '@/lib/entity-redirect';
import {
  localeAlternates,
  breadcrumbJsonLd,
  matchJsonLd,
  matchMetaDescription,
  matchMetaTitle,
  socialMeta,
  isSupportedLocale,
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
  const jsonLd = matchJsonLd({
    locale,
    id: m.id,
    home: { id: m.homeTeam?.id, name: homeName },
    away: { id: m.awayTeam?.id, name: awayName },
    scheduledAt: m.scheduledAt,
    status: m.status,
    venue: m.venue,
  });

  // F4-1: previa con datos reales para partidos aún no jugados. La API de
  // temporada ya está cacheada 120 s; si falla, la ficha sigue funcionando.
  const preview = (m.status === 'scheduled' || m.status === 'postponed') && m.homeTeam?.id && m.awayTeam?.id
    ? await getSeasonOverview(m.seasonId)
        .then((overview) => buildMatchPreview(overview, {
          matchId: m.id,
          homeTeamId: m.homeTeam!.id,
          awayTeamId: m.awayTeam!.id,
          homeName,
          awayName,
        }))
        .catch(() => null)
    : null;

  // C3: crónica de hechos verificables del acta (remontada, hat-trick, etc.).
  const chronicle = buildMatchChronicle({
    status: m.status,
    score: m.score,
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    winType: m.winType,
    events: data.events,
  });
  const chronicleTeams: Record<string, string> = {
    ...(m.homeTeam?.id ? { [m.homeTeam.id]: homeName } : {}),
    ...(m.awayTeam?.id ? { [m.awayTeam.id]: awayName } : {}),
  };

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">
      <JsonLd data={jsonLd} />
      <JsonLd data={breadcrumbLd} />

      {/* Navegacion de vuelta: el fallback es la competición del partido (#182) */}
      <BackLink href={m.competitionId ? `/competitions/${m.competitionId}` : '/'} />
      <Breadcrumbs items={crumbs} />

      {preview && <MatchPreview data={preview} locale={locale} />}

      {/* Match Center */}
      <MatchCenterClient data={data} />

      <MatchChronicle facts={chronicle} locale={locale} teams={chronicleTeams} />
    </div>
  );
}
