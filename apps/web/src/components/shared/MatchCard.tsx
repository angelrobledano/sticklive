'use client';

import Link from 'next/link';
import type { Match, TeamSummary } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { TeamName } from '@/components/shared/TeamName';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';
import { useNow30s } from '@/lib/now-ticker';
import { finalLabelKey, penaltyText } from '@/lib/match-result';
import { APP_TZ } from '@/lib/match-time';
import { matchDisplayState, type MatchDisplayState } from '@sports/shared-types';


interface MatchCardProps {
  match: Match;
  isFavoriteTeam?: boolean;
}

/**
 * Hora del partido en la zona de la competición (columna 042); cae a
 * Europe/Madrid cuando no viene, que es como la fuente publica hoy → cero
 * cambio para las ligas actuales.
 */
export function formatTime(iso: string | null, tz?: string | null, locale = 'es'): string {
  if (!iso) return '--:--';
  // Ciclo horario forzado a 23 (0-23): con locale 'en' el defecto es 12h AM/PM,
  // impropio de un producto europeo (#413). Válido en todos los locales.
  return new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: tz || APP_TZ,
  });
}

export interface TeamLinkTarget {
  id: string;
  href: string;
  label: string;
}

/**
 * #339: extrae de un equipo (venga de un partido) el enlace a su ficha.
 * Devuelve `null` si no hay equipo o no trae id — evita emitir en el HTML un
 * enlace roto `/teams/undefined`. Función pura, testeable sin navegador.
 */
export function teamLinkTarget(team: TeamSummary | undefined | null): TeamLinkTarget | null {
  if (!team?.id) return null;
  return {
    id: team.id,
    href: `/teams/${team.id}`,
    label: team.shortName ?? team.name,
  };
}

function TeamBlock({
  team,
  align,
}: {
  team: TeamSummary | undefined;
  align: 'left' | 'right';
}) {
  const name = team?.shortName ?? team?.name ?? '???';
  const isRight = align === 'right';
  const target = teamLinkTarget(team);
  const row = `flex items-center gap-2 min-w-0 ${isRight ? 'flex-row-reverse' : ''}`;

  const content = (
    <>
      {/* Escudo / placeholder */}
      <TeamShield teamId={team?.id ?? ''} teamName={name} size={32} className="shrink-0" />
      {/* Nombre — adaptativo: oficial en escritorio, siglas en móvil (marcador = densidad crítica) */}
      {team ? (
        <TeamName
          name={team.name}
          shortName={team.shortName}
          mobile="abbr"
          className={`text-sm font-medium text-slate-800 dark:text-slate-200 truncate ${isRight ? 'text-right' : 'text-left'}`}
        />
      ) : (
        <span className={`text-sm font-medium text-slate-800 dark:text-slate-200 truncate ${isRight ? 'text-right' : 'text-left'}`}>
          {name}
        </span>
      )}
    </>
  );

  return (
    <div className={`${row} flex-1`}>
      {target ? (
        // #339: escudo+nombre enlazan a la ficha del equipo. Solo esta zona
        // captura el click; el resto del bloque deja pasar a la capa que lleva
        // al partido, así la tarjeta conserva su comportamiento previo.
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
 * Estado a pintar (testeable sin navegador). El EN DIRECTO sale solo del estado
 * que da la fuente: un partido `scheduled` cuya hora ya pasó NO se pinta como
 * live (antes se forzaba un 0-0 "En directo" que podía no estar ocurriendo:
 * retrasos, aplazamientos, horas mal publicadas). La hora solo distingue
 * "pendiente de inicio" de "sin resultado" (dato muerto) — regla única de
 * `matchDisplayState` (@sports/shared-types), la misma que la API y la app.
 */
export function matchCardState(match: Pick<Match, 'status' | 'scheduledAt' | 'startedAt'>, now: number): MatchDisplayState {
  return matchDisplayState(match.status, match.scheduledAt ?? match.startedAt, now);
}

/** Reloj compartido de 30 s (una sola suscripción en toda la app, #366). */
function useMatchCardState(match: Match): MatchDisplayState {
  return matchCardState(match, useNow30s());
}

function ScoreBlock({ match }: { match: Match }) {
  const { t, locale } = useT();
  const { status, score, scheduledAt, startedAt } = match;

  const display = useMatchCardState(match);

  if (status === 'live') {
    // En descanso, badge ámbar estático "Descanso"; en juego, verde con pulso.
    const isHalftime = match.isHalftime === true;
    return (
      <div className="flex flex-col items-center gap-1 px-3 shrink-0">
        <span className="font-score text-2xl font-extrabold tracking-tighter text-slate-900 dark:text-slate-50 tabular-nums">
          {score.home ?? 0}
          <span className="text-slate-300 dark:text-slate-600 mx-1.5 font-bold">–</span>
          {score.away ?? 0}
        </span>
        {isHalftime ? (
          <span className="inline-flex items-center gap-1 bg-halftime-deep text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
            {t('match_states.half_time')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 bg-live-deep text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden="true" />
            {t('match_states.live')}
          </span>
        )}
      </div>
    );
  }

  if (status === 'finished') {
    const pen = penaltyText(match.penalties);
    return (
      <div className="flex flex-col items-center gap-1 px-3 shrink-0">
        <span className="font-score text-2xl font-extrabold tracking-tighter text-slate-900 dark:text-slate-50 tabular-nums">
          {score.home ?? '-'}
          <span className="text-slate-300 dark:text-slate-600 mx-1.5 font-bold">–</span>
          {score.away ?? '-'}
        </span>
        {pen && (
          <span className="text-[10px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">
            {t('match_states.penalties_label')} {pen}
          </span>
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full
                         bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {t(finalLabelKey(match.winType))}
        </span>
      </div>
    );
  }

  if (status === 'postponed') {
    return (
      <div className="flex flex-col items-center gap-1 px-3 shrink-0">
        <span className="text-xs font-semibold text-amber-500 uppercase tracking-wide">
          {tt(t, 'match_states.postponed', 'Aplazado')}
        </span>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="flex flex-col items-center gap-1 px-3 shrink-0">
        <span className="text-xs font-semibold text-rose-500 uppercase tracking-wide">
          {tt(t, 'match_states.cancelled', 'Cancelado')}
        </span>
      </div>
    );
  }

  // scheduled — mostrar hora. Si ya pasó, se indica que la fuente aún no lo
  // da en juego (o que no hay resultado), nunca un directo inventado.
  return (
    <div className="flex flex-col items-center gap-0.5 px-3 shrink-0">
      <span className="font-score text-lg font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
        {formatTime(startedAt ?? scheduledAt, match.competitionTimezone, locale)}
      </span>
      {display === 'awaiting_start' && (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {tt(t, 'match_states.awaiting_start', 'Pendiente')}
        </span>
      )}
      {display === 'overdue' && (
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {tt(t, 'match_states.no_result', 'Sin resultado')}
        </span>
      )}
    </div>
  );
}

export function MatchCard({ match, isFavoriteTeam = false }: MatchCardProps) {
  const { t } = useT();
  const homeName = match.homeTeam?.shortName ?? match.homeTeam?.name ?? match.homeTeamId;
  const awayName = match.awayTeam?.shortName ?? match.awayTeam?.name ?? match.awayTeamId;

  return (
    <div
      className={`card relative flex items-center px-3 py-2.5 gap-2 transition-colors
                  hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600
                  ${isFavoriteTeam ? 'ring-1 ring-rink-passion/30 dark:ring-rink-passion/40' : ''}`}
    >
      {/*
        #339: toda la tarjeta sigue llevando al detalle del partido. Es una capa
        (z-0) por DEBAJO de los enlaces de equipo (z-10) — no se anidan <a>: el
        nombre/escudo de cada equipo va a su ficha y el resto de la tarjeta
        (marcador, huecos) al partido.
      */}
      <Link
        href={`/matches/${match.id}`}
        aria-label={tt(t, 'a11y.view_match', 'Ver partido: {home} - {away}', { home: homeName, away: awayName })}
        className="absolute inset-0 z-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent"
      />
      <div className="pointer-events-none relative z-10 flex w-full items-center gap-2">
        <TeamBlock team={match.homeTeam} align="left" />
        <div className="shrink-0">
          <ScoreBlock match={match} />
        </div>
        <TeamBlock team={match.awayTeam} align="right" />
      </div>
    </div>
  );
}
