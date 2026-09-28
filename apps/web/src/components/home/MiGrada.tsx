'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { Match } from '@/lib/api/client';
import { MatchCard } from '@/components/shared/MatchCard';
import { useT } from '@/lib/i18n';
import { selectGradaMatches } from './grada';

interface MiGradaProps {
  /** Partidos ya cargados por la home (`/matches/current`). */
  matches: Match[];
  /** Ids de equipos seguidos. */
  teamIds: string[];
  /** Ids de competiciones/ligas seguidas. */
  leagueIds: string[];
  /** Día de "hoy" en Europe/Madrid (YYYY-MM-DD). */
  todayKey: string;
}

/**
 * #263 "Mi grada" — feed agregado de los equipos/ligas seguidos: próximos
 * partidos y últimos resultados, independientemente del día seleccionado.
 * Visible en móvil y escritorio. No hace peticiones: reutiliza los partidos que
 * la home ya carga en servidor.
 */
export function MiGrada({ matches, teamIds, leagueIds, todayKey }: MiGradaProps) {
  const { t } = useT();
  const { upcoming, results } = useMemo(
    () => selectGradaMatches(matches, { teamIds, leagueIds, todayKey }),
    [matches, teamIds, leagueIds, todayKey],
  );

  if (teamIds.length === 0 && leagueIds.length === 0) return null;
  if (upcoming.length === 0 && results.length === 0) return null;

  const followedTeams = new Set(teamIds);
  const isFav = (m: Match) => followedTeams.has(m.homeTeamId) || followedTeams.has(m.awayTeamId);

  const renderList = (list: Match[]) => (
    <ul className="px-4 space-y-2">
      {list.map((m) => (
        <li key={m.id}>
          <MatchCard match={m} isFavoriteTeam={isFav(m)} />
        </li>
      ))}
    </ul>
  );

  return (
    <section className="pt-5 pb-2">
      <div className="flex items-center justify-between px-4 pb-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          ⭐ {t('favorites.grada_title')}
        </span>
        <Link
          href="/favorites"
          className="text-[11px] font-semibold text-rink-passion hover:underline shrink-0 min-h-[44px] inline-flex items-center"
        >
          {t('favorites.manage')}
        </Link>
      </div>

      {upcoming.length > 0 && (
        <div>
          <p className="px-4 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-rink-passion">
            {t('favorites.grada_upcoming')}
          </p>
          {renderList(upcoming)}
        </div>
      )}

      {results.length > 0 && (
        <div className={upcoming.length > 0 ? 'mt-4' : undefined}>
          <p className="px-4 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t('favorites.grada_results')}
          </p>
          {renderList(results)}
        </div>
      )}
    </section>
  );
}
