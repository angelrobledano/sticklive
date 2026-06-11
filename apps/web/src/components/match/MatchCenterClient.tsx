'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { AdBanner } from '@/components/shared/AdBanner';
import type { MatchDetail, MatchEvent, MatchEventType } from '@/lib/api/client';
import { TeamShield } from '@/components/shared/TeamShield';
import { PlayerAvatar } from '@/components/shared/PlayerAvatar';
import { ShareButton } from '@/components/shared/ShareButton';
import { useT } from '@/lib/i18n';
import { track } from '@/lib/analytics';


// ─── Lógica de hockey: umbrales de falta directa por acumulación ──────────────

const FOUL_THRESHOLDS = [10, 15, 20, 25, 30];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(iso: string | null): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('es-ES', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-ES', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    timeZone: 'Europe/Madrid',
  });
}

function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * "Nombre Apellido" legible a partir de first/last de la API.
 * Solo el primer apellido: las mayúsculas sostenidas y los dos apellidos
 * de la fuente fatigan y rompen el ancho en móvil.
 */
function playerFullName(p: { firstName: string; lastName: string } | null): string {
  if (!p) return '';
  const surname = p.lastName.trim().split(/\s+/)[0] ?? '';
  return toTitleCase(`${p.firstName} ${surname}`.trim());
}

/**
 * Igual que playerFullName pero desde el nombre crudo de la alineación
 * ("ALABART GONZALEZ IGNACIO" → "Ignacio Alabart").
 */
function displayLineupName(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 1) return toTitleCase(parts[0]!);
  const first = parts[parts.length - 1]!;
  const surname = parts[0]!;
  return toTitleCase(`${first} ${surname}`);
}

// ─── Evento virtual: falta directa por acumulación ───────────────────────────

interface AccumulatedFoulEvent {
  id: string;
  eventType: 'accumulated_foul';
  minute: number | null;
  period: number | null;
  clock?: string | null;
  teamId: string;
  isHomeTeam: boolean;
  foulNumber: number;
  detail: null;
  player: null;
}

interface PeriodDividerEvent {
  id: string;
  eventType: 'period_divider';
  period: number;
  minute: null;
  teamId: null;
  isHomeTeam: boolean;
  detail: null;
  player: null;
}

type TimelineEvent = MatchEvent | AccumulatedFoulEvent | PeriodDividerEvent;

/**
 * Inserta un divisor visual al inicio de cada periodo para que se vea
 * de un vistazo en qué parte ocurre cada evento.
 */
function injectPeriodDividers(events: TimelineEvent[]): TimelineEvent[] {
  const result: TimelineEvent[] = [];
  let currentPeriod: number | null = null;
  for (const ev of events) {
    if (ev.period !== null && ev.period !== undefined && ev.period !== currentPeriod) {
      currentPeriod = ev.period;
      result.push({
        id: `pd-${currentPeriod}`,
        eventType: 'period_divider',
        period: currentPeriod,
        minute: null,
        teamId: null,
        isHomeTeam: true,
        detail: null,
        player: null,
      });
    }
    result.push(ev);
  }
  return result;
}

function injectAccumulatedFouls(events: MatchEvent[], homeTeamId: string): TimelineEvent[] {
  const result: TimelineEvent[] = [];
  let homeFouls = 0;
  let awayFouls = 0;

  // Base del conteo: eventos 'foul' reales (ficha) si existen;
  // fallback legacy a tarjetas azules para partidos scrapeados antes.
  const hasRealFouls = events.some((e) => e.eventType === 'foul');
  const countableType = hasRealFouls ? 'foul' : 'blue_card';

  for (const ev of events) {
    // Las faltas individuales no se pintan (inundarían la cronología):
    // solo generan las marcas de acumulación 10ª/15ª... (falta directa).
    if (ev.eventType !== 'foul') result.push(ev);
    if (ev.eventType === countableType) {
      if (ev.teamId === homeTeamId) {
        homeFouls++;
        if (FOUL_THRESHOLDS.includes(homeFouls)) {
          result.push({
            id: `vf-home-${homeFouls}`,
            eventType: 'accumulated_foul',
            minute: ev.minute,
            period: ev.period,
            clock: ev.clock ?? null,
            teamId: homeTeamId,
            isHomeTeam: true,
            foulNumber: homeFouls,
            detail: null,
            player: null,
          });
        }
      } else if (ev.teamId !== null) {
        awayFouls++;
        if (FOUL_THRESHOLDS.includes(awayFouls)) {
          result.push({
            id: `vf-away-${awayFouls}`,
            eventType: 'accumulated_foul',
            minute: ev.minute,
            period: ev.period,
            clock: ev.clock ?? null,
            teamId: ev.teamId,
            isHomeTeam: false,
            foulNumber: awayFouls,
            detail: null,
            player: null,
          });
        }
      }
    }
  }
  return result;
}

// ─── Iconos de evento ─────────────────────────────────────────────────────────

function EventIcon({ type }: { type: MatchEventType | 'accumulated_foul' }) {
  switch (type) {
    case 'goal':
      return (
        <div className="w-7 h-7 rounded-full bg-slate-800 dark:bg-white flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={1.5} className="w-4 h-4 dark:stroke-slate-900">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3C12 3 9 7 9 12s3 9 3 9M12 3c0 0 3 4 3 9s-3 9-3 9M3 12h18" strokeWidth={1} />
          </svg>
        </div>
      );
    case 'blue_card':
      return (
        <div className="w-5 h-7 rounded-sm bg-blue-500 flex items-center justify-center shrink-0">
          <span className="text-white text-[9px] font-extrabold leading-none">A</span>
        </div>
      );
    case 'red_card':
      return (
        <div className="w-5 h-7 rounded-sm bg-red-600 flex items-center justify-center shrink-0">
          <span className="text-white text-[9px] font-extrabold leading-none">R</span>
        </div>
      );
    case 'penalty':
      return (
        <div className="w-7 h-7 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
          <span className="text-white text-[10px] font-extrabold">P</span>
        </div>
      );
    case 'timeout':
      return (
        <div className="w-7 h-7 rounded-full bg-slate-400 dark:bg-slate-600 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-4 h-4">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" strokeLinecap="round" />
          </svg>
        </div>
      );
    case 'accumulated_foul':
      return (
        <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-4 h-4">
            <path d="M10.3 3.7L2.3 18a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" />
            <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
          </svg>
        </div>
      );
    case 'direct_foul':
      return (
        <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-4 h-4">
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="4.5" />
            <circle cx="12" cy="12" r="1" fill="white" />
          </svg>
        </div>
      );
    default:
      return <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 shrink-0" />;
  }
}

// ─── Cabecera del partido ─────────────────────────────────────────────────────

function TeamCrest({ team }: {
  team: { id: string; name: string; shortName: string | null; logoUrl: string | null };
}) {
  const initials = (team.shortName ?? team.name).slice(0, 3).toUpperCase();
  return (
    <Link href={`/teams/${team.id}`} className="flex flex-col items-center gap-2 hover:opacity-80 transition-opacity min-w-0">
      <TeamShield teamId={team.id} teamName={team.name} size={64} />
      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 text-center leading-tight line-clamp-2 max-w-[90px]">
        {team.shortName ?? team.name}
      </span>
    </Link>
  );
}

/** Apellido corto del jugador de un evento ("ALABART GONZALEZ" → "Alabart") */
function eventSurname(p: { firstName: string; lastName: string }): string {
  const last = (p.lastName || p.firstName).trim().split(/\s+/)[0] ?? '';
  return toTitleCase(last);
}

/** Goleadores y tarjetas bajo el marcador — lo esencial de un vistazo */
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
      <span className="tabular-nums text-slate-400 dark:text-slate-500 whitespace-nowrap">
        {(e.period === 2 ? t('match_detail.p2_short') + ' ' : e.period && e.period > 2 ? t('match_detail.ot_short') + ' ' : '')}
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

/** Bola de hockey: negra con anillo sutil (visible en ambos temas) */
function BallIcon({ size = 9 }: { size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="inline-block rounded-full bg-slate-900 dark:bg-white
                 ring-1 ring-slate-400/60 dark:ring-slate-500/60 shrink-0"
      aria-hidden="true"
    />
  );
}

/**
 * Crono del evento en clave de hockey: TIEMPO RESTANTE en formato MM:SS,
 * tal y como lo mostraba el marcador (cuenta atrás desde 25:00 por parte).
 * Si el acta no trae el instante exacto (eventos antiguos sin reprocesar),
 * se aproxima desde el minuto transcurrido: restante ≈ 25 - minuto.
 */
function fmtEventClock(ev: { clock?: string | null; minute: number | null }): string {
  if (ev.clock) return ev.clock;
  if (ev.minute == null) return '–:–';
  const remaining = Math.max(0, 25 - ev.minute);
  return `${String(remaining).padStart(2, '0')}:00`;
}

function MatchHeader({ data, sseStatus }: { data: MatchDetail; sseStatus?: string }) {
  const { t } = useT();
  const { match, stats } = data;
  const ht = match.homeTeam!;
  const at = match.awayTeam!;
  const isLive = match.status === 'live';
  const isFinished = match.status === 'finished';
  const showScore = isLive || isFinished;

  return (
    <div className="card relative px-4 pt-4 pb-5 space-y-4">
      <ShareButton
        kind="match"
        title={`${ht.shortName ?? ht.name} ${match.score.home ?? ''}-${match.score.away ?? ''} ${at.shortName ?? at.name}`}
        className="absolute top-3 right-3"
      />
      {/* Estado */}
      <div className="text-center h-5">
        {isLive && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {t('match_states.live')}
            {/* Indicador de conexión SSE */}
            {sseStatus === 'live' && (
              <span className="ml-1.5 text-[9px] font-normal text-emerald-500/70 normal-case tracking-normal">
                · {t('match_detail.auto_update')}
              </span>
            )}
            {sseStatus === 'error' && (
              <span className="ml-1.5 text-[9px] font-normal text-amber-500 normal-case tracking-normal">
                · {t('match_detail.reconnecting')}
              </span>
            )}
          </span>
        )}
        {isFinished && (
          <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('match_detail.finished')}</span>
        )}
        {!isLive && !isFinished && (
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {formatDate(match.scheduledAt)} · {formatTime(match.scheduledAt)}
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
            <div className="font-score text-5xl font-bold tracking-tighter text-slate-900 dark:text-slate-50 tabular-nums leading-none">
              {match.score.home ?? 0}
              <span className="text-slate-300 dark:text-slate-600 mx-2 font-light">:</span>
              {match.score.away ?? 0}
            </div>
          ) : (
            <div className="font-score text-3xl font-semibold text-slate-400 dark:text-slate-500 tabular-nums">
              {formatTime(match.scheduledAt)}
            </div>
          )}
          {match.status === 'postponed' && (
            <span className="text-xs font-bold text-amber-500 uppercase tracking-wide">Aplazado</span>
          )}
        </div>

        <div className="flex-1 flex justify-center">
          <TeamCrest team={at} />
        </div>
      </div>

      {/* Goleadores y tarjetas — lo esencial sin entrar al timeline */}
      {showScore && <EventSummary events={data.events} />}

      {/* Faltas de equipo */}
      {/* Sin icono: una tarjeta azul al lado confundía (son faltas de equipo,
          no tarjetas). El número grande + etiqueta se explican solos. */}
      <div className="flex justify-between items-center px-2">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-lg font-bold text-slate-800 dark:text-slate-100">{stats.homeFouls}</span>
          <span className="text-xs text-slate-400 dark:text-slate-500">{t('match_detail.fouls')}</span>
        </div>
        <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-medium">{t('match_detail.team_fouls_header')}</span>
        <div className="flex items-baseline gap-1.5">
          <span className="text-xs text-slate-400 dark:text-slate-500">{t('match_detail.fouls')}</span>
          <span className="font-mono text-lg font-bold text-slate-800 dark:text-slate-100">{stats.awayFouls}</span>
        </div>
      </div>

      {/* Venue / árbitro */}
      {(match.venue || match.referee) && (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-0.5 pt-3 border-t border-slate-100 dark:border-slate-800">
          {match.venue && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              {match.venue.name}{match.venue.city ? ` · ${match.venue.city}` : ''}
            </span>
          )}
          {match.referee && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">Árb. {match.referee}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab A: Timeline ──────────────────────────────────────────────────────────

function eventTitle(ev: TimelineEvent, t: (k: string, v?: Record<string, string | number>) => string): string {
  // El equipo lo comunica la posición en el modelo espejo (local izquierda,
  // visitante derecha) — aquí solo el tipo de evento, sin redundancia.
  switch (ev.eventType) {
    case 'goal':            return t('timeline_events.goal');
    case 'penalty':         return t('timeline_events.penalty');
    case 'blue_card':       return t('timeline_events.blue_card');
    case 'red_card':        return t('timeline_events.red_card');
    case 'timeout':         return t('timeline_events.timeout');
    case 'direct_foul':     return t('timeline_events.direct_foul');
    case 'period_end':      return t('match_detail.end_of_period', { n: ev.period ?? '' });
    case 'accumulated_foul': {
      const v = ev as AccumulatedFoulEvent;
      return t('timeline_events.team_foul_nth', { n: v.foulNumber });
    }
    default: return '';
  }
}

function TimelineRow({ ev, sameInstantAsPrev = false }: {
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
        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-wider shrink-0">
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
        directScored ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
      }`}>
        · {directScored ? t('timeline_events.scored') : t('timeline_events.missed')}
      </span>
    ) : ev.eventType === 'penalty' && ev.detail ? (
      <span className={`text-xs font-bold uppercase tracking-wide ${
        ev.detail.toLowerCase().includes('gol') || ev.detail.toLowerCase().includes('marc')
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-red-500 dark:text-red-400'
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
      : ev.eventType === 'timeout' ? 'low' : 'mid';

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
    // Tiempo muerto: una sola línea gris, mínima
    <span className="text-[11px] text-slate-400 dark:text-slate-600">{eventTitle(ev, t)}</span>
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
          {'player' in ev && ev.player && (
            <Link href={`/players/${ev.player.id}`}
                  className="block text-xs text-slate-500 dark:text-slate-400 hover:text-rink-passion hover:underline truncate">
              {playerFullName(ev.player)}
            </Link>
          )}
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
      {/* Lado local: [texto] [icono] → centro */}
      <div className={`flex items-center justify-end gap-2 min-w-0 pr-1 ${isHome ? '' : 'invisible'}`}>
        {isHome && cell}
        {isHome && (tier === 'low'
          ? <TimeoutDot />
          : <EventIcon type={ev.eventType} />)}
      </div>

      {/* Crono restante — nodo central que interrumpe la línea */}
      <span className={`justify-self-center z-10 px-1 font-mono text-center
                        bg-white dark:bg-slate-900 tabular-nums ${
        sameInstantAsPrev
          ? 'text-[10px] text-slate-300 dark:text-slate-700'
          : tier === 'low'
            ? 'text-[10px] text-slate-400 dark:text-slate-600'
            : 'text-[11px] font-semibold text-slate-500 dark:text-slate-400'
      }`}>
        {sameInstantAsPrev ? '·' : fmtEventClock(ev)}
      </span>

      {/* Lado visitante: centro → [icono] [texto] */}
      <div className={`flex items-center justify-start gap-2 min-w-0 pl-1 ${isHome ? 'invisible' : ''}`}>
        {!isHome && (tier === 'low'
          ? <TimeoutDot />
          : <EventIcon type={ev.eventType} />)}
        {!isHome && cell}
      </div>
    </div>
  );
}

/** Icono mínimo para tiempos muertos (nivel bajo) */
function TimeoutDot() {
  return (
    <span className="w-4 h-4 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
           className="w-2.5 h-2.5 text-slate-400 dark:text-slate-600">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function TimelineTab({ data }: { data: MatchDetail }) {
  const { t } = useT();
  const homeTeamId = data.match.homeTeam!.id;
  const homeName = data.match.homeTeam!.shortName ?? data.match.homeTeam!.name;
  const awayName = data.match.awayTeam!.shortName ?? data.match.awayTeam!.name;

  const timeline = useMemo(
    () => injectPeriodDividers(injectAccumulatedFouls(data.events, homeTeamId)),
    [data.events, homeTeamId]
  );

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
            <p className="text-xs text-slate-400 dark:text-slate-600 leading-relaxed">
              {t('match_detail.waiting_start_body')}
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
            <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
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
        <p className="text-sm text-slate-400 dark:text-slate-600">{t('match_detail.no_events')}</p>
      </div>
    );
  }

  return (
    <div className="card relative px-3 py-2">
      {/* Eje central del timeline */}
      <div className="absolute left-1/2 top-3 bottom-3 w-px -translate-x-1/2
                      bg-slate-100 dark:bg-slate-800" aria-hidden="true" />
      {timeline.map((ev, i) => {
        // Causa-efecto: mismo instante exacto (periodo + crono) que el evento
        // anterior → se agrupan visualmente y el eje no repite el tiempo.
        const prev = timeline[i - 1];
        const sameInstant = !!prev && !!(ev as { clock?: string | null }).clock
          && (prev as { clock?: string | null }).clock === (ev as { clock?: string | null }).clock
          && prev.period === ev.period
          && prev.eventType !== 'period_divider' && prev.eventType !== 'period_end';
        return (
          <TimelineRow key={ev.id} ev={ev} homeName={homeName} awayName={awayName}
                       sameInstantAsPrev={sameInstant} />
        );
      })}
    </div>
  );
}

// ─── Tab B: Alineaciones ──────────────────────────────────────────────────────

// Badges normalizados: misma altura y padding, tipografía legible (11px)
// y contraste accesible — 5i en acento sólido, C ámbar sólido, P gris neutro.
const BADGE_BASE = 'inline-flex items-center justify-center h-5 min-w-[22px] px-1.5 rounded text-[11px] font-bold leading-none';
const BADGE_STYLES = {
  '5i': 'bg-rink-passion text-white',
  'C':  'bg-amber-500 text-white',
  'P':  'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
} as const;

// ─── Pista con los cinco iniciales ───────────────────────────────────────────

interface RinkPlayer {
  jerseyNumber: number | null;
  playerName: string;
  playerId?: string | null;
  isGoalkeeper: boolean;
  isCaptain: boolean;
  photoUrl?: string | null;
}

/**
 * Posiciones del 5 inicial en media pista HORIZONTAL.
 * x: 0 = portería propia, 100 = línea central. y: 0-100 vertical.
 * Formación 2-2: defensas cerca del área, delanteros hacia el centro.
 */
function halfPositions(fieldCount: number): Array<{ x: number; y: number }> {
  switch (fieldCount) {
    case 4: return [{ x: 42, y: 28 }, { x: 42, y: 72 }, { x: 74, y: 34 }, { x: 74, y: 66 }];
    case 3: return [{ x: 42, y: 50 }, { x: 72, y: 28 }, { x: 72, y: 72 }];
    case 2: return [{ x: 55, y: 32 }, { x: 55, y: 68 }];
    case 1: return [{ x: 55, y: 50 }];
    default: return [];
  }
}

function RinkChip({ p, accent }: { p: RinkPlayer; accent: boolean }) {
  const surname = displayLineupName(p.playerName).split(' ').slice(-1)[0] ?? '';
  const chip = (
    <div className="flex flex-col items-center gap-0.5 -translate-x-1/2 -translate-y-1/2">
      <span className={`relative w-10 h-10 rounded-full overflow-visible shadow-md ring-2 ${
        accent ? 'ring-rink-passion' : 'ring-white dark:ring-slate-200'
      }`}>
        {/* Foto del jugador con fallback a silueta */}
        <PlayerAvatar
          photoUrl={p.photoUrl ?? null}
          name={p.playerName}
          className="w-10 h-10 rounded-full bg-white dark:bg-slate-300"
        />
        {/* Dorsal en mini-badge, color del equipo */}
        <span className={`absolute -bottom-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full
                          flex items-center justify-center font-score text-[9px] font-bold ${
          accent ? 'bg-rink-passion text-white' : 'bg-white text-slate-800 border border-slate-300'
        }`}>
          {p.jerseyNumber ?? '–'}
        </span>
        {p.isCaptain && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-white
                           text-[8px] font-bold flex items-center justify-center">C</span>
        )}
      </span>
      <span className="max-w-[76px] truncate text-[10px] font-semibold leading-tight
                       text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
        {surname}
      </span>
    </div>
  );
  return p.playerId
    ? <Link href={`/players/${p.playerId}`} className="absolute hover:scale-110 transition-transform"
            style={{ left: 0, top: 0 }} aria-label={p.playerName}>{chip}</Link>
    : <div className="absolute" style={{ left: 0, top: 0 }}>{chip}</div>;
}

function StartingFiveRink({ home, away, homeName, awayName }: {
  home: RinkPlayer[];
  away: RinkPlayer[];
  homeName: string;
  awayName: string;
}) {
  const { t } = useT();
  const rinkRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);

  /** Renderiza la pista a PNG y la comparte (o descarga como fallback) */
  const shareLineup = async () => {
    if (!rinkRef.current || sharing) return;
    setSharing(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(rinkRef.current, { scale: 2, backgroundColor: '#0b1220' });
      canvas.toBlob(async (blob) => {
        if (!blob) { setSharing(false); return; }
        const file = new File([blob], 'stick-live-alineacion.png', { type: 'image/png' });
        try {
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: 'Stick Live' });
          } else {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'stick-live-alineacion.png';
            a.click();
            URL.revokeObjectURL(a.href);
          }
        } catch { /* cancelado */ }
        setSharing(false);
      }, 'image/png');
    } catch {
      setSharing(false);
    }
  };

  if (home.length === 0 && away.length === 0) return null;

  /** Coordenadas absolutas (%) para un equipo en su mitad (local izquierda) */
  const place = (players: RinkPlayer[], isAway: boolean) => {
    const gk = players.find((p) => p.isGoalkeeper) ?? null;
    const field = players.filter((p) => p !== gk);
    const spots = halfPositions(Math.min(field.length, 4));
    const out: Array<{ p: RinkPlayer; x: number; y: number }> = [];
    if (gk) out.push({ p: gk, x: 22, y: 50 }); // dentro del área pero separado del borde
    field.slice(0, 4).forEach((p, i) => {
      const s = spots[i]!;
      out.push({ p, x: s.x, y: s.y });
    });
    // Media pista propia: x de equipo (0-100) → x global (0-50); visitante espejado
    return out.map(({ p, x, y }) => ({
      p,
      x: isAway ? 100 - x / 2 : x / 2,
      y,
    }));
  };

  const positioned = [
    ...place(away, true).map((e) => ({ ...e, accent: false })),
    ...place(home, false).map((e) => ({ ...e, accent: true })),
  ];

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2.5 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {t('match_detail.starter')}
        </span>
        <span className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-slate-500">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-rink-passion inline-block" />{homeName}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-white border border-slate-300 inline-block" />{awayName}
          </span>
          {/* Compartir la alineación como imagen */}
          <button
            onClick={shareLineup}
            disabled={sharing}
            aria-label={t('match_detail.share_lineup')}
            className="w-8 h-8 -my-1.5 rounded-full flex items-center justify-center
                       text-slate-400 hover:text-rink-passion hover:bg-slate-100 dark:hover:bg-slate-800
                       transition-colors disabled:opacity-40"
          >
            {sharing ? (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-rink-passion/30 border-t-rink-passion animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-[16px] h-[16px]">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
              </svg>
            )}
          </button>
        </span>
      </div>

      {/* Pista horizontal según plano reglamentario: rectángulo con esquinas
          redondeadas, línea central + círculo, áreas rectangulares con
          semicírculo en la línea de gol y puntos de penalti/FD. */}
      <div ref={rinkRef} className="relative mx-auto w-full max-w-[560px] aspect-[2/1] px-2 pb-3">
        <div className="absolute inset-x-2 inset-y-0 rounded-2xl overflow-hidden
                        bg-gradient-to-br from-sky-700 to-sky-800 dark:from-slate-700 dark:to-slate-800
                        border-[3px] border-sky-900/50 dark:border-slate-900/70">
          {/* Línea central + círculo con punto */}
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/50" />
          <div className="absolute left-1/2 top-1/2 w-[18%] aspect-square -translate-x-1/2 -translate-y-1/2
                          rounded-full border border-white/50" />
          <div className="absolute left-1/2 top-1/2 w-1 h-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" />

          {/* Área izquierda: rectángulo + semicírculo sobre la línea de gol */}
          <div className="absolute left-[6%] top-1/2 -translate-y-1/2 w-[14%] h-[46%]
                          border border-white/45" />
          <div className="absolute left-[6%] top-1/2 w-[5%] aspect-square -translate-x-1/2 -translate-y-1/2
                          rounded-full border border-white/45" />
          {/* Puntos de penalti/FD izquierda */}
          <div className="absolute left-[22.5%] top-1/2 w-1 h-1 -translate-y-1/2 rounded-full bg-white/70" />
          <div className="absolute left-[27%]   top-1/2 w-1 h-1 -translate-y-1/2 rounded-full bg-white/70" />

          {/* Área derecha (espejo) */}
          <div className="absolute right-[6%] top-1/2 -translate-y-1/2 w-[14%] h-[46%]
                          border border-white/45" />
          <div className="absolute right-[6%] top-1/2 w-[5%] aspect-square translate-x-1/2 -translate-y-1/2
                          rounded-full border border-white/45" />
          <div className="absolute right-[22.5%] top-1/2 w-1 h-1 -translate-y-1/2 rounded-full bg-white/70" />
          <div className="absolute right-[27%]   top-1/2 w-1 h-1 -translate-y-1/2 rounded-full bg-white/70" />

          {/* Porterías — sobre la línea de gol, dentro de la pista */}
          <div className="absolute left-[6%]  top-1/2 -translate-y-1/2 -translate-x-full w-[1.2%] h-[16%] bg-white/70 rounded-l" />
          <div className="absolute right-[6%] top-1/2 -translate-y-1/2 translate-x-full w-[1.2%] h-[16%] bg-white/70 rounded-r" />
        </div>

        {/* Jugadores */}
        {positioned.map(({ p, x, y, accent }, i) => (
          <div key={`${p.playerName}-${i}`} className="absolute"
               style={{ left: `${x}%`, top: `${y}%` }}>
            <RinkChip p={p} accent={accent} />
          </div>
        ))}
      </div>
    </div>
  );
}

function LineupsTab({ data }: { data: MatchDetail }) {
  const { t } = useT();
  const teams = [
    { team: data.match.homeTeam!, label: t('match_detail.local'),   players: data.lineups?.home ?? [] },
    { team: data.match.awayTeam!, label: t('match_detail.visitor'), players: data.lineups?.away ?? [] },
  ];

  const starters = (side: 'home' | 'away') =>
    (data.lineups?.[side] ?? []).filter((p) => p.isStarter);

  return (
    <div className="space-y-4">
      {/* Cinco inicial sobre la pista — visitante arriba, local abajo */}
      <StartingFiveRink
        home={starters('home')}
        away={starters('away')}
        homeName={data.match.homeTeam?.shortName ?? data.match.homeTeam?.name ?? ''}
        awayName={data.match.awayTeam?.shortName ?? data.match.awayTeam?.name ?? ''}
      />
      {teams.map(({ team, label, players }) => (
        <div key={team.id} className="card p-4">
          <div className="flex items-center gap-2 mb-4">
            <TeamShield teamId={team.id} teamName={team.name} size={24} />
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{team.name}</h3>
            <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-600 uppercase tracking-wider">{label}</span>
          </div>

          {/* Leyenda de badges */}
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 mb-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            {[
              { badge: '5i', label: t('match_detail.starter'), color: BADGE_STYLES['5i'] },
              { badge: 'C', label: t('match_detail.captain'), color: BADGE_STYLES['C'] },
              { badge: 'P', label: t('match_detail.goalkeeper'), color: BADGE_STYLES['P'] },
            ].map(({ badge, label: bl, color }) => (
              <div key={badge} className="flex items-center gap-1">
                <span className={`${BADGE_BASE} ${color}`}>{badge}</span>
                <span className="text-[10px] text-slate-400 dark:text-slate-600">{bl}</span>
              </div>
            ))}
            <div className="flex items-center gap-1">
              <BallIcon size={9} />
              <span className="text-[10px] text-slate-400 dark:text-slate-600">{t('hockey_stats.goals')}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px]">🅰</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-600">{t('hockey_stats.assists')}</span>
            </div>
          </div>

          {players.length === 0 ? (
            <div className="py-6 text-center">
              <span className="text-[11px] text-slate-400 dark:text-slate-600">
                {t('match_detail.lineup_unavailable')}
              </span>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {players.map((p) => (
                <div key={`${p.jerseyNumber}-${p.playerName}`} className="flex items-center gap-3 py-2">
                  <span className="w-7 text-center font-score text-sm font-bold text-slate-500 dark:text-slate-400">
                    {p.jerseyNumber ?? '–'}
                  </span>
                  {p.playerId ? (
                    <Link
                      href={`/players/${p.playerId}`}
                      title={toTitleCase(p.playerName)}
                      className="text-sm text-slate-800 dark:text-slate-200 truncate hover:text-rink-passion hover:underline"
                    >
                      {displayLineupName(p.playerName)}
                    </Link>
                  ) : (
                    <span className="text-sm text-slate-800 dark:text-slate-200 truncate" title={toTitleCase(p.playerName)}>
                      {displayLineupName(p.playerName)}
                    </span>
                  )}
                  <span className="flex items-center gap-1 ml-auto shrink-0">
                    {p.goals > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                        <BallIcon size={8} /> {p.goals}
                      </span>
                    )}
                    {(p.assists ?? 0) > 0 && (
                      <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                        🅰 {p.assists}
                      </span>
                    )}
                    {p.isStarter && <span className={`${BADGE_BASE} ${BADGE_STYLES['5i']}`}>5i</span>}
                    {p.isCaptain && <span className={`${BADGE_BASE} ${BADGE_STYLES['C']}`}>C</span>}
                    {p.isGoalkeeper && <span className={`${BADGE_BASE} ${BADGE_STYLES['P']}`}>P</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Tab C: Estadísticas ──────────────────────────────────────────────────────

function StatRow({ label, home, away, max }: {
  label: string; home: number; away: number; max: number;
}) {
  const safeMax = max || 1;
  const homePct = Math.round((home / safeMax) * 100);
  const awayPct = Math.round((away / safeMax) * 100);

  return (
    <div className="space-y-1">
      {/* Título de la métrica ENCIMA, centrado y legible — no camuflado entre barras */}
      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 text-center">{label}</p>
      <div className="flex items-center gap-2">
        <span className="w-7 text-sm font-bold tabular-nums text-slate-900 dark:text-slate-50 text-right">{home}</span>
        {/* Dos barras enfrentadas desde el centro; ambos lados con color activo */}
        <div className="flex flex-1 h-2 items-center gap-px">
          <div className="flex-1 flex justify-end rounded-l-full overflow-hidden bg-slate-100 dark:bg-slate-800 h-full">
            <div className="bg-rink-passion h-full rounded-l-full transition-all duration-500" style={{ width: `${homePct}%` }} />
          </div>
          <div className="flex-1 rounded-r-full overflow-hidden bg-slate-100 dark:bg-slate-800 h-full">
            <div className="bg-slate-600 dark:bg-slate-300 h-full rounded-r-full transition-all duration-500" style={{ width: `${awayPct}%` }} />
          </div>
        </div>
        <span className="w-7 text-sm font-bold tabular-nums text-slate-900 dark:text-slate-50">{away}</span>
      </div>
    </div>
  );
}

function StatsTab({ data }: { data: MatchDetail }) {
  const { t } = useT();
  const { stats, match } = data;
  const totalFouls = stats.homeFouls + stats.awayFouls;
  const totalPen = stats.homePenalties.total + stats.awayPenalties.total;

  if (stats.homeFouls === 0 && stats.awayFouls === 0) {
    if (match.status === 'scheduled') {
      return (
        <div className="card p-8 text-center opacity-60">
          <p className="text-sm text-slate-400 dark:text-slate-600">{t('match_detail.stats_pending')}</p>
        </div>
      );
    }
    return (
      <div className="card p-8 flex justify-center">
        <div className="inline-flex items-center gap-2.5 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-amber-500 shrink-0">
            <path d="M10.3 3.7L2.3 18a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" />
            <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
          </svg>
          <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
            Estadisticas de faltas y bola parada en proceso de computo.
          </span>
        </div>
      </div>
    );
  }

  const homePenEfic = stats.homePenalties.total > 0
    ? Math.round((stats.homePenalties.scored / stats.homePenalties.total) * 100) : 0;
  const awayPenEfic = stats.awayPenalties.total > 0
    ? Math.round((stats.awayPenalties.scored / stats.awayPenalties.total) * 100) : 0;

  return (
    <>
    <div className="card p-5 space-y-5">
      {/* Cabecera de columnas */}
      <div className="flex justify-between text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
        <span>{match.homeTeam?.shortName ?? 'Local'}</span>
        <span>{match.awayTeam?.shortName ?? 'Visitante'}</span>
      </div>

      <StatRow label={t('hockey_stats.goals')} home={stats.homeGoals ?? 0} away={stats.awayGoals ?? 0} max={Math.max(stats.homeGoals ?? 0, stats.awayGoals ?? 0)} />

      {((stats.homeAssists ?? 0) > 0 || (stats.awayAssists ?? 0) > 0) && (
        <StatRow label={t('hockey_stats.assists')} home={stats.homeAssists ?? 0} away={stats.awayAssists ?? 0} max={Math.max(stats.homeAssists ?? 0, stats.awayAssists ?? 0)} />
      )}

      <div className="h-px bg-slate-100 dark:bg-slate-800" />

      <StatRow label={t('hockey_stats.team_fouls')} home={stats.homeFouls} away={stats.awayFouls} max={Math.max(stats.homeFouls, stats.awayFouls)} />

      <StatRow label={t('hockey_stats.blue_cards')} home={stats.homeBlueCards ?? 0} away={stats.awayBlueCards ?? 0} max={Math.max(stats.homeBlueCards ?? 0, stats.awayBlueCards ?? 0)} />

      {((stats.homeRedCards ?? 0) > 0 || (stats.awayRedCards ?? 0) > 0) && (
        <StatRow label={t('hockey_stats.red_cards')} home={stats.homeRedCards ?? 0} away={stats.awayRedCards ?? 0} max={Math.max(stats.homeRedCards ?? 0, stats.awayRedCards ?? 0)} />
      )}

      <StatRow label={t('hockey_stats.time_outs')} home={stats.homeTimeouts ?? 0} away={stats.awayTimeouts ?? 0} max={Math.max(stats.homeTimeouts ?? 0, stats.awayTimeouts ?? 0)} />

      {(((stats.homeDirectFouls?.total ?? 0) + (stats.awayDirectFouls?.total ?? 0)) > 0) && (
        <>
          <div className="h-px bg-slate-100 dark:bg-slate-800" />
          <StatRow
            label={t('hockey_stats.direct_fouls_shot')}
            home={stats.homeDirectFouls?.total ?? 0}
            away={stats.awayDirectFouls?.total ?? 0}
            max={Math.max(stats.homeDirectFouls?.total ?? 0, stats.awayDirectFouls?.total ?? 0)}
          />
          <StatRow
            label={t('hockey_stats.direct_fouls_scored')}
            home={stats.homeDirectFouls?.scored ?? 0}
            away={stats.awayDirectFouls?.scored ?? 0}
            max={Math.max(stats.homeDirectFouls?.total ?? 0, stats.awayDirectFouls?.total ?? 0, 1)}
          />
          <div className="flex justify-between items-baseline pt-1 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              {(stats.homeDirectFouls?.total ?? 0) > 0 ? Math.round(((stats.homeDirectFouls?.scored ?? 0) / stats.homeDirectFouls!.total) * 100) : 0}%
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 flex-1 text-center px-3">{t('match_detail.direct_fouls_efficiency')}</span>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              {(stats.awayDirectFouls?.total ?? 0) > 0 ? Math.round(((stats.awayDirectFouls?.scored ?? 0) / stats.awayDirectFouls!.total) * 100) : 0}%
            </span>
          </div>
        </>
      )}

      {totalPen > 0 && (
        <>
          <div className="h-px bg-slate-100 dark:bg-slate-800" />
          <StatRow label={t('hockey_stats.penalties_shot')} home={stats.homePenalties.total} away={stats.awayPenalties.total} max={Math.max(stats.homePenalties.total, stats.awayPenalties.total)} />
          <StatRow label={t('hockey_stats.penalties_scored')} home={stats.homePenalties.scored} away={stats.awayPenalties.scored} max={Math.max(stats.homePenalties.total, stats.awayPenalties.total, 1)} />
          <div className="flex justify-between items-baseline pt-1 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">{homePenEfic}%</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 flex-1 text-center px-3">{t('match_detail.penalties_efficiency')}</span>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">{awayPenEfic}%</span>
          </div>
        </>
      )}
    </div>

    {/* Banner de monetización al final de las estadísticas
        Solo visible para usuarios Free — nulo para Premium */}
    <AdBanner zone="match-stats" className="mt-2 rounded-xl overflow-hidden" />
  </>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

const TABS = ['Resumen', 'Alineaciones', 'Estadísticas'] as const;
type Tab = typeof TABS[number];
const TAB_KEYS: Record<Tab, string> = {
  'Resumen':      'match_tabs.summary',
  'Alineaciones': 'match_tabs.lineups',
  'Estadísticas': 'match_tabs.stats',
};

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

// ─── Indicador de partido en vivo ─────────────────────────────────────────────

function LivePulse() {
  const { t } = useT();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
      </span>
      <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest">
        {t('match_states.live')}
      </span>
    </span>
  );
}

export function MatchCenterClient({ data: initialData }: { data: MatchDetail }) {
  const { t } = useT();
  const [activeTab,  setActiveTab]  = useState<Tab>('Resumen');
  // Estado local que empieza con los datos SSR y se actualiza en caliente via SSE
  const [liveData,   setLiveData]   = useState<MatchDetail>(initialData);
  const [sseStatus,  setSseStatus]  = useState<'idle' | 'connecting' | 'live' | 'finished' | 'error'>('idle');

  const isLive = liveData.match.status === 'live';

  // ── Analítica: una vista por partido y montaje ─────────────────────────────
  useEffect(() => {
    track('match_view', {
      match_id: initialData.match.id,
      status: initialData.match.status,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData.match.id]);

  // ── Conexión SSE ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLive) {
      setSseStatus('idle');
      return;
    }

    setSseStatus('connecting');
    const url = `${API_URL}/matches/${liveData.match.id}/stream`;
    const es = new EventSource(url);

    const handleData = (raw: string) => {
      try {
        const parsed = JSON.parse(raw) as MatchDetail;
        setLiveData(parsed);
      } catch { /* JSON malformado — ignorar */ }
    };

    es.addEventListener('snapshot', (e) => {
      setSseStatus('live');
      handleData((e as MessageEvent<string>).data);
    });

    es.addEventListener('update', (e) => {
      handleData((e as MessageEvent<string>).data);
    });

    es.addEventListener('finished', () => {
      setSseStatus('finished');
      es.close();
    });

    es.addEventListener('timeout', () => {
      setSseStatus('idle');
      es.close();
    });

    es.addEventListener('keepalive', () => { /* noop — mantiene la conexión */ });

    es.onerror = () => {
      setSseStatus('error');
      // EventSource auto-reintenta — no cerramos aquí
    };

    return () => {
      es.close();
      setSseStatus('idle');
    };
  }, [liveData.match.id, isLive]);

  // ── Polling de fallback cada 30s para partidos live sin SSE ────────────────
  // (cubre browsers que no soportan EventSource o cuando SSE falla)
  const refreshData = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/matches/${liveData.match.id}`);
      if (!res.ok) return;
      const parsed = (await res.json()) as MatchDetail;
      setLiveData(parsed);
    } catch { /* sin red — siguiente intento */ }
  }, [liveData.match.id]);

  useEffect(() => {
    if (!isLive || sseStatus === 'live') return; // SSE ya cubre — no duplicar
    const interval = setInterval(refreshData, 30_000);
    return () => clearInterval(interval);
  }, [isLive, sseStatus, refreshData]);

  // ── Refresco al pasar la hora de inicio de un partido 'scheduled' ──────────
  // Cubre el hueco hasta que el scraper marque el partido como live y el
  // bloque SSE de arriba tome el relevo.
  useEffect(() => {
    if (isLive) return;
    const startIso = liveData.match.scheduledAt ?? liveData.match.startedAt;
    if (!startIso) return;
    const delay = new Date(startIso).getTime() - Date.now();
    if (delay <= 0 || delay > 6 * 3_600_000) return;
    const timer = setTimeout(refreshData, delay + 60_000);
    return () => clearTimeout(timer);
  }, [isLive, liveData.match.scheduledAt, liveData.match.startedAt, refreshData]);

  const data = liveData; // alias para no cambiar el resto del JSX

  return (
    <div className="space-y-4">
      {/* Cabecera del partido */}
      <MatchHeader data={data} sseStatus={sseStatus} />

      {/* Pestañas */}
      <div className="flex gap-0 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm border-b -mb-px transition-colors whitespace-nowrap ${
              activeTab === tab
                ? 'border-rink-passion text-rink-passion font-semibold'
                : 'border-transparent font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t(TAB_KEYS[tab])}
          </button>
        ))}
      </div>

      {/* Contenido */}
      {activeTab === 'Resumen'      && <TimelineTab   data={data} />}
      {activeTab === 'Alineaciones' && <LineupsTab    data={data} />}
      {activeTab === 'Estadísticas' && <StatsTab      data={data} />}
    </div>
  );
}
