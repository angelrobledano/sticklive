'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Match, TeamSummary } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { TeamName } from '@/components/shared/TeamName';
import { teamLinkTarget } from '@/components/shared/MatchCard';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';

interface LiveBoardProps {
  match: Match;
  isFavoriteTeam?: boolean;
}

/**
 * Pulso visual cuando el marcador cambia en directo ("una jugada, una vez").
 * Sin parpadeo en el primer render: el valor previo se siembra dentro del
 * efecto (nunca durante el render), así no hay destello al montar.
 */
function useScoreFlash(home: number | null, away: number | null): boolean {
  const prev = useRef<{ h: number | null; a: number | null } | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const before = prev.current;
    prev.current = { h: home, a: away };
    if (!before) return;
    if (before.h === home && before.a === away) return;
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 1200);
    return () => clearTimeout(id);
  }, [home, away]);

  return flash;
}

const NAME_CLS = 'block truncate text-sm font-semibold text-slate-800 dark:text-slate-100';

function TeamSide({ team, name, align }: {
  team: TeamSummary | undefined;
  name: string;
  align: 'left' | 'right';
}) {
  const isRight = align === 'right';
  const row = `flex min-w-0 items-center gap-2.5 ${isRight ? 'flex-row-reverse text-right' : 'text-left'}`;
  const target = teamLinkTarget(team);

  const content = (
    <>
      <TeamShield teamId={team?.id ?? ''} teamName={name} size={40} className="shrink-0" />
      {team ? (
        <TeamName name={team.name} shortName={team.shortName} className={NAME_CLS} />
      ) : (
        <span className={NAME_CLS}>{name}</span>
      )}
    </>
  );

  return (
    <div className={`${row} min-w-0`}>
      {target ? (
        // Escudo+nombre enlazan a la ficha del equipo; el resto de la tarjeta
        // (capa de abajo) lleva al partido, igual que en MatchCard.
        <Link
          href={target.href}
          className={`${row} pointer-events-auto rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent`}
        >
          {content}
        </Link>
      ) : (
        content
      )}
    </div>
  );
}

/**
 * Tarjeta de directo con jerarquía de marcador grande — el destaque de la
 * portada en escritorio. Solo aparece en partidos 'live'; el esmeralda es
 * estado, no decoración (The Live-Only Color Rule).
 */
export function LiveBoard({ match, isFavoriteTeam = false }: LiveBoardProps) {
  const { t } = useT();
  const home = match.homeTeam;
  const away = match.awayTeam;
  const homeName = home?.shortName ?? home?.name ?? match.homeTeamId;
  const awayName = away?.shortName ?? away?.name ?? match.awayTeamId;
  const flash = useScoreFlash(match.score.home, match.score.away);
  const isHalftime = match.isHalftime === true;

  return (
    <div
      className="card relative flex flex-col gap-3 overflow-hidden p-4 transition-shadow
                 ring-1 ring-emerald-500/25 hover:shadow-md
                 dark:ring-emerald-400/25"
    >
      {/* Capa de fondo: toda la tarjeta abre el partido. Los enlaces de equipo
          van por encima (z-10) y capturan su propia zona. */}
      <Link
        href={`/matches/${match.id}`}
        aria-label={tt(t, 'a11y.view_match', 'Ver partido: {home} - {away}', { home: homeName, away: awayName })}
        className="absolute inset-0 z-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent"
      />

      <div className="relative z-10 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {isFavoriteTeam && (
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
                 className="h-3.5 w-3.5 shrink-0 text-rink-passion">
              <path d="M12 2l3.09 6.26L22 9.27l-4.91 4.79 1.16 6.94L12 17.77l-6.25 3.23 1.16-6.94L2 9.27l6.91-1.01L12 2z" />
            </svg>
          )}
          <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {match.competitionName}
          </span>
        </span>

        {isHalftime ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            {t('match_states.half_time')}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
            {t('match_states.in_play')}
          </span>
        )}
      </div>

      <div className="pointer-events-none relative z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <TeamSide team={home} name={homeName} align="left" />
        <span
          className={`font-score text-4xl font-extrabold leading-none tracking-tighter tabular-nums text-slate-900 dark:text-slate-50 ${flash ? 'score-flash' : ''}`}
        >
          {match.score.home ?? 0}
          <span className="mx-1.5 font-bold text-slate-300 dark:text-slate-600">–</span>
          {match.score.away ?? 0}
        </span>
        <TeamSide team={away} name={awayName} align="right" />
      </div>
    </div>
  );
}
