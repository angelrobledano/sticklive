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

export function generateMetadata({ params }: Props): Metadata {
  const locale = isSupportedLocale(params.locale) ? params.locale : 'en';
  return { alternates: localeAlternates(locale, `/competitions/${params.id}`) };
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
