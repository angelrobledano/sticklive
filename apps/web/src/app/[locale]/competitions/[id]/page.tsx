import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { localeAlternates, socialMeta, isSupportedLocale, competitionJsonLd, SITE_URL } from '@/lib/seo';
import {
  getSeasonOverview,
  getCompetitionSeasons,
  getSeasonStats,
  isApiNotFound,
  type CompetitionSeason,
  type SeasonStats,
} from '@/lib/api/client';
import { CompetitionClient } from '@/components/competition/CompetitionClient';
import { BackLink } from '@/components/shared/BackLink';
import { JsonLd } from '@/components/shared/JsonLd';

interface Props {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ season?: string }>;
}

const DESC: Record<string, (n: string) => string> = {
  es: (n) => `${n}: clasificación, calendario, resultados, playoffs y estadísticas de hockey patines en Stick Live.`,
  en: (n) => `${n}: standings, fixtures, results, playoffs and rink hockey stats on Stick Live.`,
  pt: (n) => `${n}: classificação, calendário, resultados, playoffs e estatísticas de hóquei em patins no Stick Live.`,
  fr: (n) => `${n} : classement, calendrier, résultats, playoffs et statistiques de rink hockey sur Stick Live.`,
  it: (n) => `${n}: classifica, calendario, risultati, playoff e statistiche di hockey su pista su Stick Live.`,
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  const requested = searchParams.season;
  const alternates = localeAlternates(locale, `/competitions/${params.id}`);
  try {
    const seasons = await getCompetitionSeasons(params.id);
    // La temporada efectiva es la misma que sirve el cuerpo (#279): si el enlace
    // trae ?season=, el preview debe anunciar ESA temporada, no la en curso.
    const season =
      (requested && seasons.find((s) => s.id === requested)) ||
      seasons.find((s) => s.isCurrent) ||
      seasons[0];
    if (!season) return { alternates };
    const overview = await getSeasonOverview(season.id);
    const name = `${overview.season.competitionName} ${season.name ?? ''}`.trim();
    const title = `${name} | Stick Live`;
    const description = (DESC[locale] ?? DESC['en'])!(name);
    // #279: solo añadimos `?season=` a la URL si la temporada pedida existe de
    // verdad (la misma que sirve el cuerpo). Un `?season=` inválido cae a la
    // temporada en curso y no debe quedar en la URL compartida.
    const path = requested && season.id === requested
      ? `/competitions/${params.id}?season=${requested}`
      : `/competitions/${params.id}`;
    return {
      title,
      description,
      alternates,
      ...socialMeta({ locale, path, title: name, description, dynamicImage: true }),
    };
  } catch {
    return { alternates };
  }
}

/**
 * Vista de competición. El [id] es el id de COMPETICIÓN: por defecto se
 * muestra la temporada en curso (o la más reciente) y un selector discreto
 * permite saltar a temporadas anteriores vía ?season=<uuid>.
 * Retrocompatible: si el id resulta ser un id de temporada, se carga directa.
 */
export default async function CompetitionPage(props: Props) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  let seasons: CompetitionSeason[] = [];
  try {
    seasons = await getCompetitionSeasons(params.id);
  } catch (err) {
    if (!isApiNotFound(err)) throw err;
    // 404 → puede ser un id de temporada (enlaces antiguos); seguimos sin histórico
  }

  // Temporada a mostrar: ?season válida > temporada en curso > la más reciente
  const requested = searchParams.season;
  const seasonId =
    (requested && seasons.some((s) => s.id === requested) && requested) ||
    seasons.find((s) => s.isCurrent)?.id ||
    seasons[0]?.id ||
    params.id; // retrocompatibilidad

  // #350: overview y stats dependen solo de seasonId, así que se piden en
  // paralelo (un round-trip menos). El 404 de overview sigue siendo notFound();
  // el fallo de stats no bloquea la vista porque los líderes son opcionales.
  let data;
  let stats: SeasonStats | null = null;
  try {
    [data, stats] = await Promise.all([
      getSeasonOverview(seasonId),
      getSeasonStats(seasonId).catch(() => null),
    ]);
  } catch (err) {
    if (isApiNotFound(err)) notFound();
    throw err; // error boundary con reintento
  }

  // #349: structured data de la competición (liga) y su temporada.
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  const competitionLd = competitionJsonLd({
    leagueName: data.season.competitionName,
    leagueUrl: `${SITE_URL}/${locale}/competitions/${params.id}`,
    seasonName: data.season.name,
    startDate: data.season.startDate,
    endDate: data.season.endDate,
    country: data.season.competitionCountry,
  });

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">
      <JsonLd data={competitionLd} />

      <BackLink href="/competitions" />

      <CompetitionClient data={data} seasons={seasons} competitionId={params.id} stats={stats} />
    </div>
  );
}
