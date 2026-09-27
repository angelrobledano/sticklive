'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { Match } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { TeamName } from '@/components/shared/TeamName';
import { useT } from '@/lib/i18n';
import { finalLabelKey, penaltyText } from '@/lib/match-result';
import { APP_TZ } from '@/lib/match-time';


interface MatchCardProps {
  match: Match;
  isFavoriteTeam?: boolean;
}

/**
 * Hora del partido en la zona de la competición (columna 042); cae a
 * Europe/Madrid cuando no viene, que es como la fuente publica hoy → cero
 * cambio para las ligas actuales.
 */
function formatTime(iso: string | null, tz?: string | null): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz || APP_TZ,
  });
}

function TeamBlock({
  team,
  align,
}: {
  team: { id: string; name: string; shortName: string | null; logoUrl: string | null } | undefined;
  align: 'left' | 'right';
}) {
  const name = team?.shortName ?? team?.name ?? '???';
  const isRight = align === 'right';

  // Sin enlace propio: en una lista de partidos, TODA la tarjeta lleva al
  // detalle del partido (expectativa del usuario en esta vista). La ficha
  // del equipo es accesible desde el detalle.
  return (
    <div
      className={`flex items-center gap-2 min-w-0 flex-1 ${isRight ? 'flex-row-reverse' : ''}`}
    >
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
    </div>
  );
}

/**
 * Parche reactivo: devuelve true si el partido esta como 'scheduled'
 * pero la hora actual ya ha superado su hora de inicio.
 * Re-evalua cada 30 s. Eliminar cuando el scraper estabilice la ficha resumen.
 */
function useIsMatchOverdue(match: Match): boolean {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (match.status !== 'scheduled') return;
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [match.status]);

  if (match.status !== 'scheduled') return false;
  const startIso = match.scheduledAt ?? match.startedAt;
  if (!startIso) return false;
  const start = new Date(startIso).getTime();
  // Solo forzar "en juego" dentro de una ventana realista de partido (3 h).
  // Más allá, el dato está desactualizado o el partido no se jugó: mostrar hora.
  const MATCH_WINDOW_MS = 3 * 3_600_000;
  return now > start && now - start < MATCH_WINDOW_MS;
}

function ScoreBlock({ match }: { match: Match }) {
  const { t } = useT();
  const { status, score, scheduledAt, startedAt } = match;

  // Si scheduled pero ya paso la hora de inicio, forzar badge live en UI
  const isOverdue = useIsMatchOverdue(match);
  const effectiveStatus = isOverdue ? 'live' : status;

  if (effectiveStatus === 'live') {
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
          <span className="inline-flex items-center gap-1 bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
            {t('match_states.half_time')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            {t('match_states.in_play')}
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
          <span className="text-[9px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">
            {t('match_states.penalties_label')} {pen}
          </span>
        )}
        <span className="text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full
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
          Aplazado
        </span>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="flex flex-col items-center gap-1 px-3 shrink-0">
        <span className="text-xs font-semibold text-rose-500 uppercase tracking-wide">
          Cancelado
        </span>
      </div>
    );
  }

  // scheduled — mostrar hora
  return (
    <div className="flex flex-col items-center gap-0.5 px-3 shrink-0">
      <span className="font-score text-lg font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
        {formatTime(startedAt ?? scheduledAt, match.competitionTimezone)}
      </span>
    </div>
  );
}

export function MatchCard({ match, isFavoriteTeam = false }: MatchCardProps) {
  return (
    <Link
      href={`/matches/${match.id}`}
      className={`card flex items-center px-3 py-2.5 gap-2 transition-colors block
                  hover:shadow-md hover:border-slate-300 dark:hover:border-slate-600
                  ${isFavoriteTeam ? 'ring-1 ring-rink-passion/30 dark:ring-rink-passion/40' : ''}`}
    >
      <TeamBlock team={match.homeTeam} align="left" />
      <div className="shrink-0">
        <ScoreBlock match={match} />
      </div>
      <TeamBlock team={match.awayTeam} align="right" />
    </Link>
  );
}
