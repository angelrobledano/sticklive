'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import type { MatchDetail } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { ShareButton } from '@/components/shared/ShareButton';
import { finalLabelKey, penaltyText } from '@/lib/match-result';
import { formatTime, formatDate, eventSurname, fmtEventClock } from './format';
import { freshnessState } from './timeline-model';
import { BallIcon } from './icons';

function TeamCrest({ team }: {
  team: { id: string; name: string; shortName: string | null; logoUrl: string | null };
}) {
  return (
    <Link href={`/teams/${team.id}`} className="flex flex-col items-center gap-2 hover:opacity-80 transition-opacity min-w-0">
      <TeamShield teamId={team.id} teamName={team.name} size={64} />
      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 text-center leading-tight line-clamp-2 max-w-[90px]">
        {team.shortName ?? team.name}
      </span>
    </Link>
  );
}

/** Desglose de la tanda de penaltis: dos columnas (local/visitante), ✓ marcado / ✗ fallado. */
function PenaltyShootout({ shootout, homeName, awayName }: {
  shootout: { home: { player: string; scored: boolean }[]; away: { player: string; scored: boolean }[] };
  homeName: string;
  awayName: string;
}) {
  const { t } = useT();
  const Kick = ({ k, right }: { k: { player: string; scored: boolean }; right?: boolean }) => (
    <li className={`flex items-center gap-1.5 text-xs ${right ? 'flex-row-reverse text-right' : ''}`}>
      <span className={`shrink-0 w-4 h-4 inline-flex items-center justify-center rounded-full text-[10px] font-bold ${
        k.scored ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
      }`}>
        {k.scored ? '✓' : '✗'}
      </span>
      <span className={`truncate ${k.scored ? 'text-slate-800 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400'}`}>
        {k.player}
      </span>
    </li>
  );
  return (
    <div className="card p-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-center text-slate-500 dark:text-slate-400 mb-2">
        {t('match_states.penalties_label')}
      </p>
      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 truncate">{homeName}</p>
          <ul className="space-y-1.5">
            {shootout.home.map((k, i) => <Kick key={i} k={k} />)}
          </ul>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 truncate text-right">{awayName}</p>
          <ul className="space-y-1.5">
            {shootout.away.map((k, i) => <Kick key={i} k={k} right />)}
          </ul>
        </div>
      </div>
    </div>
  );
}

function EventSummary({ events }: { events: MatchDetail['events'] }) {
  const { t } = useT();
  const interesting = (events ?? []).filter(
    (e) => (e.eventType === 'goal' || e.eventType === 'blue_card' || e.eventType === 'red_card') && e.player
  );
  if (interesting.length === 0) return null;

  const Item = ({ e }: { e: typeof interesting[number] }) => (
    <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
      {e.eventType === 'goal'
        ? <BallIcon size={8} />
        : <span className={`inline-block w-[7px] h-[10px] rounded-[1.5px] shrink-0 ${
            e.eventType === 'blue_card' ? 'bg-blue-500' : 'bg-red-500'
          }`} />}
      <span className="truncate max-w-[100px]">{eventSurname(e.player!)}</span>
      <span className="tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
        {(e.period === 1 ? t('match_detail.p1_short') + ' ' : e.period === 2 ? t('match_detail.p2_short') + ' ' : e.period && e.period > 2 ? t('match_detail.ot_short') + ' ' : '')}
        {fmtEventClock(e)}
      </span>
    </span>
  );

  return (
    <div className="grid grid-cols-2 gap-x-8 pt-1">
      <div className="flex flex-col items-end gap-0.5">
        {interesting.filter((e) => e.isHomeTeam).map((e) => <Item key={e.id} e={e} />)}
      </div>
      <div className="flex flex-col items-start gap-0.5">
        {interesting.filter((e) => !e.isHomeTeam).map((e) => <Item key={e.id} e={e} />)}
      </div>
    </div>
  );
}

/**
 * Fase + crono en vivo: "Descanso", o "En directo · 2ª Parte · 12:34".
 * La fuente da el RESTANTE del periodo (cuenta atrás desde 25:00); aquí se
 * muestra el TRANSCURRIDO y se hace correr localmente desde el instante de
 * captura (clockAt), resincronizando cuando llega un nuevo snapshot. Se congela
 * en el descanso. Puede desviarse unos segundos por paradas de reloj entre polls.
 */
function LivePhase({ live }: { live: NonNullable<MatchDetail['match']['live']> }) {
  const { t } = useT();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (live.isHalftime || live.clockSeconds == null || !live.clockAt) {
      setRemaining(null);
      return;
    }
    // En hockey el crono cuenta ATRÁS desde 25:00. La fuente da el restante;
    // lo hacemos decrecer desde el instante de captura (clockAt).
    const base = live.clockSeconds;
    const anchor = new Date(live.clockAt).getTime();
    const tick = () => {
      const r = base - (Date.now() - anchor) / 1000;
      setRemaining(Math.max(0, Math.min(1500, Math.round(r))));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [live.isHalftime, live.clockSeconds, live.clockAt]);

  if (live.isHalftime) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest">
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        {t('match_states.half_time')}
      </span>
    );
  }

  const periodLabel = live.period === 2
    ? t('match_states.second_half')
    : live.period === 1
      ? t('match_states.first_half')
      : null;
  const mmss = remaining != null
    ? `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`
    : null;

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
      {t('match_states.live')}
      {periodLabel && (
        <span className="ml-1.5 font-semibold normal-case tracking-normal tabular-nums text-emerald-600/90 dark:text-emerald-400/90">
          {periodLabel}{mmss ? ` · ${mmss}` : ''}
        </span>
      )}
    </span>
  );
}

export function MatchHeader({ data, sseStatus, lastUpdateAt = null, serverStale = false }: {
  data: MatchDetail;
  sseStatus?: string;
  lastUpdateAt?: number | null;
  serverStale?: boolean;
}) {
  const { t } = useT();
  const { match, stats } = data;
  const ht = match.homeTeam!;
  const at = match.awayTeam!;
  const isLive = match.status === 'live';
  const isFinished = match.status === 'finished';
  const showScore = isLive || isFinished;

  // #284: reloj de 1 s para el indicador de frescura. `now` arranca en null para
  // que el HTML del servidor y la primera hidratación coincidan (sin el texto).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!isLive) { setNow(null); return; }
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [isLive]);

  // Frescura: si hace demasiado que no llega un snapshot/update (o el hub avisó
  // de un poll caído), atenuamos el marcador para no mostrarlo como actual.
  const freshness = isLive && now != null && lastUpdateAt != null
    ? freshnessState(lastUpdateAt, now, serverStale)
    : null;
  const faded = isLive && showScore && freshness?.state === 'down';

  return (
    <div className="card relative px-4 pt-4 pb-5 space-y-4">
      <ShareButton
        kind="match"
        title={`${ht.shortName ?? ht.name} ${match.score.home ?? ''}-${match.score.away ?? ''} ${at.shortName ?? at.name}`}
        className="absolute top-3 right-3"
      />
      {/* Competición a la que pertenece el partido (#182) */}
      {match.competitionId && match.competitionName && (
        <div className="text-center -mt-1">
          <Link
            href={`/competitions/${match.competitionId}`}
            className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 hover:text-rink-passion transition-colors"
          >
            {match.competitionName}
          </Link>
        </div>
      )}
      {/* Estado */}
      <div className="text-center min-h-5">
        {isLive && (
          <span className="inline-flex items-center gap-1.5">
            {match.live ? (
              <LivePhase live={match.live} />
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
                {t('match_states.live')}
              </span>
            )}
            {/* En directo se sobreentiende que se actualiza en vivo; solo avisamos
                si la conexión se cae. */}
            {sseStatus === 'error' && (
              <span className="text-[10px] font-normal text-amber-500 normal-case tracking-normal">
                · {t('match_detail.reconnecting')}
              </span>
            )}
            {/* #284: cuándo se actualizó por última vez / posible desfase. */}
            {freshness && (
              <span
                className={`text-[10px] font-normal normal-case tracking-normal ${
                  freshness.state === 'down'
                    ? 'text-rose-500'
                    : freshness.state === 'stale'
                      ? 'text-amber-500'
                      : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                · {t(freshness.labelKey, { s: freshness.ageSeconds })}
              </span>
            )}
          </span>
        )}
        {isFinished && (
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-widest">{t(finalLabelKey(match.winType))}</span>
        )}
        {!isLive && !isFinished && (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {formatDate(match.scheduledAt, match.competitionTimezone)} · {formatTime(match.scheduledAt, match.competitionTimezone)}
          </span>
        )}
      </div>

      {/* Escudos + marcador */}
      <div className="flex items-center gap-2">
        <div className="flex-1 flex justify-center">
          <TeamCrest team={ht} />
        </div>

        <div className="flex flex-col items-center shrink-0 px-2 gap-1">
          {showScore ? (
            <div role="status" aria-live="polite" aria-atomic="true"
                 aria-label={`${ht.shortName ?? ht.name} ${match.score.home ?? 0} - ${match.score.away ?? 0} ${at.shortName ?? at.name}`}
                 className={`font-score text-5xl font-bold tracking-tighter text-slate-900 dark:text-slate-50 tabular-nums leading-none transition-opacity ${faded ? 'opacity-40' : ''}`}>
              {match.score.home ?? 0}
              <span className="text-slate-300 dark:text-slate-600 mx-2 font-light">:</span>
              {match.score.away ?? 0}
            </div>
          ) : (
            <div className="font-score text-3xl font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
              {formatTime(match.scheduledAt, match.competitionTimezone)}
            </div>
          )}
          {match.status === 'postponed' && (
            <span className="text-xs font-bold text-amber-500 uppercase tracking-wide">Aplazado</span>
          )}
          {match.status === 'cancelled' && (
            <span className="text-xs font-bold text-rose-500 uppercase tracking-wide">Cancelado</span>
          )}
        </div>

        <div className="flex-1 flex justify-center">
          <TeamCrest team={at} />
        </div>
      </div>

      {/* Prórroga / penaltis: marcador de la tanda + ganador (que un empate no oculte quién ganó) */}
      {isFinished && penaltyText(match.penalties) && (
        <p className="text-center text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400 -mt-1">
          {t('match_states.penalties_label')} {penaltyText(match.penalties)}
        </p>
      )}
      {isFinished && match.winnerTeamId && match.winType !== 'regular' && (
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          {t('match_states.winner')}: <span className="font-bold text-slate-800 dark:text-slate-100">
            {match.winnerTeamId === ht.id ? (ht.shortName ?? ht.name) : (at.shortName ?? at.name)}
          </span>
        </p>
      )}

      {/* Goleadores y tarjetas — lo esencial sin entrar al timeline */}
      {showScore && <EventSummary events={data.events} />}

      {/* Tanda de penaltis: quién marca y quién falla (lanzador a lanzador) */}
      {isFinished && match.penaltyShootout
        && (match.penaltyShootout.home.length > 0 || match.penaltyShootout.away.length > 0) && (
        <PenaltyShootout
          shootout={match.penaltyShootout}
          homeName={ht.shortName ?? ht.name}
          awayName={at.shortName ?? at.name}
        />
      )}

      {/* Faltas de equipo — solo si algún equipo acumula faltas */}
      {(stats.homeFouls > 0 || stats.awayFouls > 0) && (
        <div className="flex justify-between items-center px-2">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-lg font-bold text-slate-800 dark:text-slate-100">{stats.homeFouls}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{t('match_detail.fouls')}</span>
          </div>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-medium">{t('match_detail.team_fouls_header')}</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs text-slate-500 dark:text-slate-400">{t('match_detail.fouls')}</span>
            <span className="font-mono text-lg font-bold text-slate-800 dark:text-slate-100">{stats.awayFouls}</span>
          </div>
        </div>
      )}

      {/* Venue / árbitro */}
      {(match.venue || match.referee) && (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-0.5 pt-3 border-t border-slate-100 dark:border-slate-800">
          {match.venue && (
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {match.venue.name}{match.venue.city ? ` · ${match.venue.city}` : ''}
            </span>
          )}
          {match.referee && (
            <span className="text-[11px] text-slate-500 dark:text-slate-400">Árb. {match.referee}</span>
          )}
        </div>
      )}

      {/* Enlace de vídeo del partido (p. ej. World Skate → worldskate.tv) */}
      {match.videoUrl && (
        <div className="flex justify-center pt-1">
          <a
            href={match.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold
                       text-white bg-rink-passion hover:bg-rink-passion/90 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" />
            </svg>
            {t('match_detail.watch_video')}
          </a>
        </div>
      )}
    </div>
  );
}
