'use client';

import { useEffect, useRef, useState } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import type { Match, TeamSummary } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { formatTime, matchCardState } from '@/components/shared/MatchCard';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';
import { useNow30s } from '@/lib/now-ticker';
import { finalLabelKey, penaltyText } from '@/lib/match-result';
import { APP_TZ } from '@/lib/match-time';
import { clubName } from '@/lib/names';

/**
 * Fila compacta de partido para las tarjetas de la home (spec 2026-10-16,
 * referencia FotMob): local alineado a la derecha + escudo · hora o marcador ·
 * escudo + visitante. Toda la fila lleva al partido. Nombres completos (hasta
 * dos líneas) en lugar de siglas: en clubes las siglas eran crípticas.
 */

/** "sáb 17" (fecha corta en el idioma y la zona dados), sin puntos ni comas. */
export function shortDayLabel(iso: string | null, locale: string, tz: string = APP_TZ): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', timeZone: tz })
    .format(d)
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pulso visual cuando el marcador cambia en directo ("una jugada, una vez").
 * El valor previo se siembra dentro del efecto: no hay destello al montar.
 */
function useScoreFlash(home: number | null, away: number | null): boolean {
  const prev = useRef<{ h: number | null; a: number | null } | null>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const before = prev.current;
    prev.current = { h: home, a: away };
    if (!before || (before.h === home && before.a === away)) return;
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 1200);
    return () => clearTimeout(id);
  }, [home, away]);
  return flash;
}

function displayName(team: TeamSummary | undefined, fallback: string): string {
  return team?.name ? clubName(team.name) : fallback;
}

function Star() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-3 w-3 shrink-0 text-rink-passion dark:text-rink-accent">
      <path d="M12 2l3.09 6.26L22 9.27l-4.91 4.79 1.16 6.94L12 17.77l-6.25 3.23 1.16-6.94L2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function TeamSide({ team, name, side, followed }: {
  team: TeamSummary | undefined;
  name: string;
  side: 'home' | 'away';
  followed: boolean;
}) {
  const isHome = side === 'home';
  return (
    <span
      data-followed={followed ? side : undefined}
      className={`flex min-w-0 items-center gap-2 ${isHome ? 'flex-row-reverse text-right' : 'text-left'}`}
    >
      <TeamShield teamId={team?.id ?? ''} teamName={name} size={20} className="shrink-0" />
      {followed && <Star />}
      <span className="min-w-0 line-clamp-2 break-words text-[13px] font-medium leading-tight text-slate-800 dark:text-slate-100">
        {name}
      </span>
    </span>
  );
}

const SUB = 'block text-[10px] font-semibold uppercase leading-none tracking-wide';

/**
 * Centro de la fila (hora, marcador o estado) y su texto para lectores de
 * pantalla. Es un hook porque la fila entera es un enlace y su `aria-label`
 * necesita el mismo texto que se pinta.
 */
function useCenter(match: Match, showDate: boolean): { node: React.ReactNode; text: string } {
  const { t, locale } = useT();
  const display = matchCardState(match, useNow30s());
  const { status, score } = match;
  const tz = match.competitionTimezone || APP_TZ;
  const day = showDate ? shortDayLabel(match.scheduledAt ?? match.startedAt, locale, tz) : '';
  const flash = useScoreFlash(status === 'live' ? score.home : null, status === 'live' ? score.away : null);

  const scoreLine = (cls: string) => (
    <span className={`font-score text-base font-extrabold leading-none tracking-tight tabular-nums ${cls} ${flash ? 'score-flash' : ''}`}>
      <span>{score.home ?? 0}</span>
      <span className="mx-1 font-bold text-slate-300 dark:text-slate-600">–</span>
      <span>{score.away ?? 0}</span>
    </span>
  );

  let body: React.ReactNode;
  let text: string;
  if (status === 'live') {
    const halftime = match.isHalftime === true;
    const state = halftime ? t('match_states.half_time') : t('match_states.live');
    text = `${score.home ?? 0}–${score.away ?? 0}, ${state}`;
    body = (
      <>
        {scoreLine(halftime ? 'text-halftime-deep dark:text-halftime' : 'text-live-deep dark:text-live')}
        {halftime ? (
          <span className={`${SUB} text-halftime-deep dark:text-halftime`}>{state}</span>
        ) : (
          <span className={`${SUB} inline-flex items-center justify-center gap-1 text-live-deep dark:text-live`}>
            <span className="h-1.5 w-1.5 rounded-full bg-live animate-pulse" aria-hidden="true" />
            {state}
          </span>
        )}
      </>
    );
  } else if (status === 'finished') {
    const pen = penaltyText(match.penalties);
    const fin = t(finalLabelKey(match.winType));
    const sub = day ? `${fin} · ${day}` : fin;
    text = `${score.home ?? '-'}–${score.away ?? '-'}, ${sub}${pen ? `, ${t('match_states.penalties_label')} ${pen}` : ''}`;
    body = (
      <>
        {scoreLine('text-slate-900 dark:text-slate-50')}
        {pen && (
          <span className="block text-[10px] font-semibold tabular-nums leading-none text-slate-500 dark:text-slate-400">
            {t('match_states.penalties_label')} {pen}
          </span>
        )}
        <span className={`${SUB} font-medium normal-case tracking-normal text-slate-500 dark:text-slate-400`}>{sub}</span>
      </>
    );
  } else if (status === 'postponed' || status === 'cancelled') {
    const state = status === 'postponed'
      ? tt(t, 'match_states.postponed', 'Aplazado')
      : tt(t, 'match_states.cancelled', 'Cancelado');
    text = day ? `${state}, ${day}` : state;
    body = (
      <>
        <span className={`${SUB} text-[11px] ${status === 'postponed' ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {state}
        </span>
        {day && <span className={`${SUB} font-medium normal-case tracking-normal text-slate-500 dark:text-slate-400`}>{day}</span>}
      </>
    );
  } else {
    const time = formatTime(match.startedAt ?? match.scheduledAt, match.competitionTimezone, locale);
    const sub = day
      || (display === 'awaiting_start' ? tt(t, 'match_states.awaiting_start', 'Pendiente')
        : display === 'overdue' ? tt(t, 'match_states.no_result', 'Sin resultado') : '');
    text = sub ? `${time}, ${sub}` : time;
    body = (
      <>
        <span className="font-score text-sm font-semibold leading-none tabular-nums text-slate-700 dark:text-slate-200">{time}</span>
        {sub && (
          <span className={`${SUB} ${day ? 'font-medium normal-case tracking-normal' : ''} text-slate-500 dark:text-slate-400`}>{sub}</span>
        )}
      </>
    );
  }

  return {
    node: <span className="flex min-w-[56px] flex-col items-center justify-center gap-1 px-1 text-center">{body}</span>,
    text,
  };
}

export function MatchRow({ match, followedTeamIds, showDate = false, caption }: {
  match: Match;
  /** Equipos seguidos: su lado lleva estrella. */
  followedTeamIds?: ReadonlySet<string>;
  /** Fecha corta bajo la hora/resultado (próxima jornada, Mi grada). */
  showDate?: boolean;
  /** Línea pequeña encima (competición, en la tarjeta Siguiendo). */
  caption?: string | null;
}) {
  const { t } = useT();
  const home = displayName(match.homeTeam, match.homeTeamId);
  const away = displayName(match.awayTeam, match.awayTeamId);
  const center = useCenter(match, showDate);

  return (
    <Link
      href={`/matches/${match.id}`}
      aria-label={`${tt(t, 'a11y.view_match', 'Ver partido: {home} - {away}', { home, away })}, ${center.text}`}
      className="block px-3 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent"
    >
      {caption && (
        <span className="mb-1 block truncate text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {caption}
        </span>
      )}
      <span className="grid min-h-[36px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <TeamSide team={match.homeTeam} name={home} side="home" followed={!!followedTeamIds?.has(match.homeTeamId)} />
        {center.node}
        <TeamSide team={match.awayTeam} name={away} side="away" followed={!!followedTeamIds?.has(match.awayTeamId)} />
      </span>
    </Link>
  );
}
