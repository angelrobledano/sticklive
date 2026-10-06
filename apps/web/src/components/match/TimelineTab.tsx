'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import type { MatchDetail } from '@/lib/api/client';
import {
  injectPeriodDividers,
  injectAccumulatedFouls,
  compareTimelineEvents,
  latestAnnounceableEvent,
  type TimelineEvent,
  type AccumulatedFoulEvent,
} from './timeline-model';
import { eventSurname, playerFullName, fmtEventClock } from './format';
import { EventIcon, FoulDot, TimeoutDot } from './icons';

/**
 * Tope de render del timeline (#366): actas largas no necesitan pintar todas
 * las filas de golpe; "ver todos" las carga explícitamente. Función pura para
 * poder fijar el comportamiento sin navegador; NO altera el orden ni el
 * subconjunto que anuncia `aria-live` (que se calcula sobre el timeline completo).
 */
export const TIMELINE_PREVIEW = 60;

export function timelineWindow<T>(
  events: readonly T[],
  showAll: boolean,
  limit: number = TIMELINE_PREVIEW,
): { visible: T[]; hiddenCount: number } {
  const visible = showAll ? events.slice() : events.slice(0, limit);
  return { visible, hiddenCount: events.length - visible.length };
}

/**
 * #357: el modelo espejo comunica el equipo por POSICIÓN (local izquierda,
 * visitante derecha), que un lector de pantalla no percibe. Esta función da el
 * nombre explícito del equipo del evento, para filas y anuncios `aria-live`.
 */
export function eventTeamName(
  ev: Pick<TimelineEvent, 'isHomeTeam'>,
  homeName: string,
  awayName: string,
): string {
  return ev.isHomeTeam ? homeName : awayName;
}

function eventTitle(ev: TimelineEvent, t: (k: string, v?: Record<string, string | number>) => string): string {
  switch (ev.eventType) {
    case 'goal':            return t('timeline_events.goal');
    case 'penalty':         return t('timeline_events.penalty');
    case 'blue_card':       return t('timeline_events.blue_card');
    case 'red_card':        return t('timeline_events.red_card');
    case 'timeout':         return t('timeline_events.timeout');
    case 'foul':            return t('timeline_events.foul');
    case 'direct_foul':     return t('timeline_events.direct_foul');
    case 'period_end':      return t('match_detail.end_of_period', { n: ev.period ?? '' });
    case 'accumulated_foul': {
      const v = ev as AccumulatedFoulEvent;
      return t('timeline_events.team_foul_nth', { n: v.foulNumber });
    }
    default: return '';
  }
}

/**
 * Frase que anuncia el evento por la región `aria-live` (#287): tipo, autor,
 * equipo y periodo/crono. #357: el equipo se nombra SIEMPRE (aunque haya
 * jugador), para que el anuncio no dependa de la posición visual.
 */
export function eventAnnouncement(
  ev: TimelineEvent,
  t: (k: string, v?: Record<string, string | number>) => string,
  homeName: string,
  awayName: string,
): string {
  const title = eventTitle(ev, t);
  const player = 'player' in ev && ev.player ? playerFullName(ev.player) : '';
  const team = eventTeamName(ev, homeName, awayName);
  const period = ev.period === 1
    ? t('match_detail.p1_short')
    : ev.period === 2
      ? t('match_detail.p2_short')
      : ev.period && ev.period > 2 ? t('match_detail.ot_short') : '';
  return [title, player, team, [period, fmtEventClock(ev)].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(' · ');
}

function TimelineRow({ ev, homeName, awayName, sameInstantAsPrev = false }: {
  ev: TimelineEvent;
  homeName: string;
  awayName: string;
  sameInstantAsPrev?: boolean;
}) {
  const { t } = useT();
  if (ev.eventType === 'period_divider') {
    return (
      <div className="flex items-center gap-3 py-3 select-none">
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0
                         px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800">
          {ev.period === 1 ? t('match_detail.first_half')
            : ev.period === 2 ? t('match_detail.second_half')
            : t('match_detail.overtime', { n: ev.period - 2 })}
        </span>
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
      </div>
    );
  }

  if (ev.eventType === 'period_end') {
    return (
      <div className="flex items-center gap-3 py-2 select-none">
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0">
          {t('match_detail.end_of_period', { n: ev.period ?? '' })}
        </span>
        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
      </div>
    );
  }

  const isVirtual = ev.eventType === 'accumulated_foul';
  const isHome = ev.isHomeTeam;
  const directScored = ev.eventType === 'direct_foul' && !!ev.detail?.includes('marcada');

  // Desenlace (FD / penalti) — primera línea, destacado
  const outcome =
    ev.eventType === 'direct_foul' && ev.detail ? (
      <span className={`text-xs font-bold uppercase tracking-wide ${
        directScored ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
      }`}>
        · {directScored ? t('timeline_events.scored') : t('timeline_events.missed')}
      </span>
    ) : ev.eventType === 'penalty' && ev.detail ? (
      <span className={`text-xs font-bold uppercase tracking-wide ${
        ev.detail.toLowerCase().includes('gol') || ev.detail.toLowerCase().includes('marc')
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-red-600 dark:text-red-400'
      }`}>
        · {ev.detail.toLowerCase().includes('gol') || ev.detail.toLowerCase().includes('marc')
            ? t('timeline_events.scored') : t('timeline_events.missed')}
      </span>
    ) : ev.eventType === 'goal' && ev.detail ? (
      <span className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400">{ev.detail}</span>
    ) : null;

  // ── Jerarquía visual de 3 niveles ──────────────────────────────────────────
  //   Alto:  goles y tarjetas (el jugador es el protagonista)
  //   Medio: faltas directas/penaltis y avisos de 10ª/15ª falta
  //   Bajo:  tiempos muertos (mínimo peso visual, no ensucian el scroll)
  const tier: 'high' | 'mid' | 'low' =
    ev.eventType === 'goal' || ev.eventType === 'blue_card' || ev.eventType === 'red_card'
      ? 'high'
      : ev.eventType === 'timeout' || ev.eventType === 'foul' ? 'low' : 'mid';

  const isGoal = ev.eventType === 'goal';
  const titleColor = isGoal
    ? 'text-emerald-600 dark:text-emerald-400'
    : ev.eventType === 'blue_card' ? 'text-blue-600 dark:text-blue-400'
    : ev.eventType === 'red_card' ? 'text-red-600 dark:text-red-400'
    : 'text-slate-800 dark:text-slate-200';

  // Celda de contenido según nivel
  const cell = isVirtual ? (
    // Aviso 10ª/15ª falta — SIEMPRE en el lado del equipo infractor
    <span className="inline-flex items-center px-2 py-0.5 rounded-md
                     bg-orange-50 dark:bg-orange-900/20 text-[11px] font-medium
                     text-orange-800 dark:text-orange-300">
      {eventTitle(ev, t)}
    </span>
  ) : tier === 'low' ? (
    // Tiempo muerto / falta: una sola línea gris, mínima, con el autor si lo hay
    <span className="text-[11px] text-slate-500 dark:text-slate-400">
      {eventTitle(ev, t)}
      {'player' in ev && ev.player ? <> · <span className="text-slate-500 dark:text-slate-400">{eventSurname(ev.player)}</span></> : null}
    </span>
  ) : (
    <div className={`min-w-0 ${isHome ? 'text-right' : 'text-left'}`}>
      {tier === 'high' && 'player' in ev && ev.player ? (
        <>
          {/* Nivel alto: el JUGADOR primero y en negrita */}
          <Link href={`/players/${ev.player.id}`}
                className="block text-sm font-bold text-slate-900 dark:text-slate-50 hover:text-rink-passion hover:underline truncate">
            {playerFullName(ev.player)}
          </Link>
          <p className={`text-xs font-semibold leading-snug ${titleColor}`}>
            {eventTitle(ev, t)}{outcome && <> {outcome}</>}
          </p>
        </>
      ) : (
        <>
          <p className={`text-[13px] leading-snug ${tier === 'high' ? `font-bold ${titleColor}` : 'text-slate-800 dark:text-slate-200'}`}>
            <span className={tier === 'high' ? '' : 'font-semibold'}>{eventTitle(ev, t)}</span>
            {outcome && <> {outcome}</>}
          </p>
          {'player' in ev && ev.player ? (
            <Link href={`/players/${ev.player.id}`}
                  className="block text-xs text-slate-500 dark:text-slate-400 hover:text-rink-passion hover:underline truncate">
              {playerFullName(ev.player)}
            </Link>
          ) : (ev.eventType === 'direct_foul' || ev.eventType === 'penalty') ? (
            // La fuente no nombra al lanzador en FD/penalti fallados (id_player=0);
            // mostramos al menos el equipo que la lanza.
            <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
              {isHome ? homeName : awayName}
            </span>
          ) : null}
        </>
      )}
    </div>
  );

  const rowPad = tier === 'low' ? 'py-0.5' : tier === 'high' ? 'py-2' : 'py-1.5';
  // Mismo instante que el evento anterior → relación causa-efecto:
  // se pega al bloque y el eje no repite el crono.
  const linked = sameInstantAsPrev ? '-mt-1' : '';

  // Modelo espejo: local a la izquierda, visitante a la derecha, con el
  // CRONO RESTANTE (MM:SS, cuenta atrás) como nodo central del eje.
  return (
    <div className={`grid grid-cols-[1fr_52px_1fr] items-center ${rowPad} ${linked}`}>
      {/* #357: el equipo se comunica por posición; lo hacemos explícito para AT. */}
      <span className="sr-only">{eventTeamName(ev, homeName, awayName)}</span>
      {/* Lado local: [texto] [icono] → centro */}
      <div className={`flex items-center justify-end gap-2 min-w-0 pr-1 ${isHome ? '' : 'invisible'}`}>
        {isHome && cell}
        {isHome && (ev.eventType === 'timeout'
          ? <TimeoutDot />
          : ev.eventType === 'foul'
            ? <FoulDot />
            : <EventIcon type={ev.eventType} />)}
      </div>

      {/* Crono restante — nodo central que interrumpe la línea */}
      <span className={`justify-self-center z-10 px-1 font-mono text-center
                        bg-white dark:bg-slate-900 tabular-nums ${
        sameInstantAsPrev
          ? 'text-[10px] text-slate-300 dark:text-slate-700'
          : tier === 'low'
            ? 'text-[10px] text-slate-500 dark:text-slate-400'
            : 'text-[11px] font-semibold text-slate-500 dark:text-slate-400'
      }`}>
        {sameInstantAsPrev ? '·' : fmtEventClock(ev)}
      </span>

      {/* Lado visitante: centro → [icono] [texto] */}
      <div className={`flex items-center justify-start gap-2 min-w-0 pl-1 ${isHome ? 'invisible' : ''}`}>
        {!isHome && (ev.eventType === 'timeout'
          ? <TimeoutDot />
          : ev.eventType === 'foul'
            ? <FoulDot />
            : <EventIcon type={ev.eventType} />)}
        {!isHome && cell}
      </div>
    </div>
  );
}

export function TimelineTab({ data }: { data: MatchDetail }) {
  const { t } = useT();
  const [showAll, setShowAll] = useState(false);
  const homeTeamId = data.match.homeTeam!.id;
  const homeName = data.match.homeTeam!.shortName ?? data.match.homeTeam!.name;
  const awayName = data.match.awayTeam!.shortName ?? data.match.awayTeam!.name;

  const timeline = useMemo(() => {
    // #285: reproducimos en cliente el orden de la API (crono restante DESC,
    // minuto como fallback) antes de intercalar los eventos virtuales, para que
    // el relato no se lea invertido aunque el backend todavía no esté al día.
    const ordered = [...data.events].sort(compareTimelineEvents);
    return injectPeriodDividers(injectAccumulatedFouls(ordered, homeTeamId));
  }, [data.events, homeTeamId]);

  // #287: el evento más reciente con señal de producto se anuncia por aria-live.
  const latest = latestAnnounceableEvent(timeline);

  if (timeline.length === 0) {
    const isScheduled = data.match.status === 'scheduled';
    const isLive      = data.match.status === 'live';
    const isFinished  = data.match.status === 'finished';

    // Scheduled: todavia no ha empezado
    if (isScheduled) {
      return (
        <div className="card p-8 flex flex-col items-center gap-4 text-center">
          <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 text-slate-300 dark:text-slate-600">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 3" strokeLinecap="round" />
            </svg>
          </div>
          <div className="space-y-1.5 max-w-xs">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('match_detail.waiting_start')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {t('match_detail.waiting_start_body')}
            </p>
          </div>
        </div>
      );
    }

    // Partido histórico (solo marcador, sin acta): mensaje propio, no "pendiente".
    if ((isLive || isFinished) && data.match.eventCoverage === 'none') {
      return (
        <div className="card p-8 flex flex-col items-center gap-5 text-center">
          <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 text-slate-500 dark:text-slate-400">
              <path d="M3 7h18M5 7v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="space-y-2 max-w-sm">
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{t('match_detail.historic_title')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {t('match_detail.historic_body')}
            </p>
          </div>
        </div>
      );
    }

    // Live o Finished con eventsCount === 0: acta de Playoff pendiente de sincronizacion
    if (isLive || isFinished) {
      return (
        <div className="card p-8 flex flex-col items-center gap-5 text-center">
          <div className="w-14 h-14 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 text-amber-400 dark:text-amber-500">
              <path d="M10.3 3.7L2.3 18a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" />
              <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
            </svg>
          </div>
          <div className="space-y-2 max-w-sm">
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{t('match_detail.report_pending_title')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {t('match_detail.report_pending_body')}
            </p>
          </div>
        </div>
      );
    }

    // Fallback generico
    return (
      <div className="card p-8 flex flex-col items-center gap-4 text-center">
        <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 text-slate-300 dark:text-slate-600">
            <circle cx="12" cy="12" r="9" /><path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('match_detail.no_events')}</p>
      </div>
    );
  }

  // Tope de render (#366): actas largas no necesitan pintar todas las filas de
  // golpe; con "ver todos" el usuario las carga explícitamente.
  const { visible, hiddenCount } = timelineWindow(timeline, showAll);

  return (
    <div className="card relative px-3 py-2">
      {/* #287: región viva que anuncia sólo el evento más reciente. Vive fuera
          del flujo visual (sr-only) para no duplicar la lectura de toda la lista. */}
      <div
        role="log"
        aria-live="polite"
        aria-atomic="true"
        aria-label={t('match_detail.timeline_aria')}
        className="sr-only"
      >
        {latest ? eventAnnouncement(latest, t, homeName, awayName) : ''}
      </div>
      {/* Eje central del timeline */}
      <div className="absolute left-1/2 top-3 bottom-3 w-px -translate-x-1/2
                      bg-slate-100 dark:bg-slate-800" aria-hidden="true" />
      {visible.map((ev, i) => {
        // Causa-efecto: mismo instante exacto (periodo + crono) que el evento
        // anterior → se agrupan visualmente y el eje no repite el tiempo.
        const prev = visible[i - 1];
        const sameInstant = !!prev && !!(ev as { clock?: string | null }).clock
          && (prev as { clock?: string | null }).clock === (ev as { clock?: string | null }).clock
          && prev.period === ev.period
          && prev.eventType !== 'period_divider' && prev.eventType !== 'period_end';
        return (
          <TimelineRow key={ev.id} ev={ev} homeName={homeName} awayName={awayName}
                       sameInstantAsPrev={sameInstant} />
        );
      })}
      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-2 w-full py-2.5 min-h-[44px] text-xs font-semibold text-rink-passion
                     rounded-xl border border-slate-200 dark:border-slate-800
                     hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
        >
          {t('match_detail.show_all_events', { n: hiddenCount })}
        </button>
      )}
    </div>
  );
}
