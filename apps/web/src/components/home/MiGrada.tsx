'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { Match } from '@/lib/api/client';
import { MatchRow } from '@/components/home/MatchRow';
import { MatchGroupCard, FollowStar } from '@/components/home/MatchGroupCard';
import { useT } from '@/lib/i18n';
import { selectGradaMatches } from './grada';

interface MiGradaProps {
  /** Partidos ya cargados (`/matches/current`). */
  matches: Match[];
  /** Ids de equipos seguidos. */
  teamIds: string[];
  /** Ids de competiciones/ligas seguidas. */
  leagueIds: string[];
  /** Día de "hoy" en Europe/Madrid (YYYY-MM-DD). */
  todayKey: string;
  /** Enlace "Gestionar" a /favorites (no tiene sentido dentro de /favorites). */
  showManage?: boolean;
}

/**
 * #263 "Mi grada" — próximos partidos y últimos resultados de los equipos y
 * ligas seguidos, de cualquier día. Desde la spec 2026-10-16 vive en Favoritos
 * y en el carril de escritorio, NUNCA en la jornada de la home (se leía como
 * partidos de hoy), y cada fila lleva su fecha.
 */
export function MiGrada({ matches, teamIds, leagueIds, todayKey, showManage = true }: MiGradaProps) {
  const { t } = useT();
  const { upcoming, results } = useMemo(
    () => selectGradaMatches(matches, { teamIds, leagueIds, todayKey }),
    [matches, teamIds, leagueIds, todayKey],
  );
  const followed = useMemo(() => new Set(teamIds), [teamIds]);

  if (teamIds.length === 0 && leagueIds.length === 0) return null;
  if (upcoming.length === 0 && results.length === 0) return null;

  const star = <span className="flex h-5 w-5 items-center justify-center"><FollowStar /></span>;

  return (
    <section aria-label={t('favorites.grada_title')} className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {t('favorites.grada_title')}
        </h2>
        {showManage && (
          <Link
            href="/favorites"
            className="inline-flex min-h-[44px] shrink-0 items-center text-[11px] font-semibold text-rink-passion hover:underline dark:text-rink-accent"
          >
            {t('favorites.manage')}
          </Link>
        )}
      </div>

      {upcoming.length > 0 && (
        <MatchGroupCard title={t('favorites.grada_upcoming')} icon={star} count={upcoming.length} collapsible={false}>
          {upcoming.map((m) => (
            <MatchRow key={m.id} match={m} followedTeamIds={followed} showDate caption={m.competitionName ?? null} />
          ))}
        </MatchGroupCard>
      )}

      {results.length > 0 && (
        <MatchGroupCard title={t('favorites.grada_results')} icon={star} count={results.length} collapsible={false}>
          {results.map((m) => (
            <MatchRow key={m.id} match={m} followedTeamIds={followed} showDate caption={m.competitionName ?? null} />
          ))}
        </MatchGroupCard>
      )}
    </section>
  );
}
