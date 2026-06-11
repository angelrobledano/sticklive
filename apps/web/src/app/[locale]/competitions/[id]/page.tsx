import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { localeAlternates, isSupportedLocale } from '@/lib/seo';
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

interface Props {
  params: { locale: string; id: string };
  searchParams: { season?: string };
}

const DESC: Record<string, (n: string) => string> = {
  es: (n) => `${n}: clasificación, calendario, resultados, playoffs y estadísticas de hockey patines en Stick Live.`,
  en: (n) => `${n}: standings, fixtures, results, playoffs and rink hockey stats on Stick Live.`,
  pt: (n) => `${n}: classificação, calendário, resultados, playoffs e estatísticas de hóquei em patins no Stick Live.`,
  fr: (n) => `${n} : classement, calendrier, résultats, playoffs et statistiques de rink hockey sur Stick Live.`,
  it: (n) => `${n}: classifica, calendario, risultati, playoff e statistiche di hockey su pista su Stick Live.`,
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  const alternates = localeAlternates(locale, `/competitions/${params.id}`);
  try {
    const seasons = await getCompetitionSeasons(params.id);
    const current = seasons.find((s) => s.isCurrent) ?? seasons[0];
    if (!current) return { alternates };
    const overview = await getSeasonOverview(current.id);
    const name = `${overview.season.competitionName} ${current.name ?? ''}`.trim();
    const title = `${name} | Stick Live`;
    const description = (DESC[locale] ?? DESC['en'])!(name);
    return { title, description, alternates, openGraph: { title, description, type: 'website' } };
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
export default async function CompetitionPage({ params, searchParams }: Props) {
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

  let data;
  try {
    data = await getSeasonOverview(seasonId);
  } catch (err) {
    if (isApiNotFound(err)) notFound();
    throw err; // error boundary con reintento
  }

  // Líderes de la temporada (goleadores, asistentes, tarjetas) — no bloqueante
  let stats: SeasonStats | null = null;
  try {
    stats = await getSeasonStats(seasonId);
  } catch { /* la vista funciona sin líderes */ }

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4">
      <BackLink href="/competitions" />

      <CompetitionClient data={data} seasons={seasons} competitionId={params.id} stats={stats} />
    </div>
  );
}
