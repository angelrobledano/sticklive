/**
 * Modelo del timeline de eventos del partido. Lógica pura (sin React):
 * intercala eventos "virtuales" — avisos de falta acumulada (10ª/15ª…) y
 * divisores de periodo — con los `MatchEvent` reales para el render cronológico.
 */
import type { MatchEvent } from '@/lib/api/client';

// Umbrales de falta directa por acumulación (hockey).
const FOUL_THRESHOLDS = [10, 15, 20, 25, 30];

export interface AccumulatedFoulEvent {
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

export interface PeriodDividerEvent {
  id: string;
  eventType: 'period_divider';
  period: number;
  minute: null;
  teamId: null;
  isHomeTeam: boolean;
  detail: null;
  player: null;
}

export type TimelineEvent = MatchEvent | AccumulatedFoulEvent | PeriodDividerEvent;

/**
 * Inserta un divisor visual al inicio de cada periodo para que se vea
 * de un vistazo en qué parte ocurre cada evento.
 */
export function injectPeriodDividers(events: TimelineEvent[]): TimelineEvent[] {
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

// ─── Frescura del directo (#284) ───────────────────────────────────────────
/**
 * Un marcador congelado no debe aparentar ser actual. La ficha guarda el
 * instante de la última actualización recibida (snapshot/update) y esta función
 * pura decide el estado a mostrar. Separar los umbrales del render permite
 * testearlos sin navegador.
 *
 * - `fresh`: llegan actualizaciones (texto "Actualizado hace X s").
 * - `stale`: hace rato que no llega nada → "posible desfase".
 * - `down`: demasiado tiempo sin señal → "sin señal".
 */
/** Hasta aquí se considera fresco (los snapshots llegan por NOTIFY casi al instante). */
export const FRESH_MAX_MS = 45_000;
/** A partir de aquí se considera sin señal; en medio, posible desfase. */
export const STALE_MAX_MS = 150_000;

export type FreshnessState = 'fresh' | 'stale' | 'down';

export interface Freshness {
  state: FreshnessState;
  /** Segundos desde la última actualización (nunca negativo). */
  ageSeconds: number;
  /** Clave i18n del texto a mostrar (con {s} = segundos). */
  labelKey: string;
}

const FRESHNESS_LABEL: Record<FreshnessState, string> = {
  fresh: 'match_detail.freshness_fresh',
  stale: 'match_detail.freshness_stale',
  down:  'match_detail.freshness_down',
};

export function freshnessState(
  lastUpdateMs: number | null,
  nowMs: number,
  serverStale = false,
): Freshness {
  if (lastUpdateMs == null) {
    return { state: 'down', ageSeconds: 0, labelKey: FRESHNESS_LABEL.down };
  }
  const ageMs = Math.max(0, nowMs - lastUpdateMs);
  const ageSeconds = Math.floor(ageMs / 1000);
  let state: FreshnessState =
    ageMs < FRESH_MAX_MS ? 'fresh' : ageMs < STALE_MAX_MS ? 'stale' : 'down';
  // El hub avisó de que su poll falló: degradamos a "posible desfase" como
  // mínimo, pero nunca maquillamos un "sin señal" real.
  if (serverStale && state === 'fresh') state = 'stale';
  return { state, ageSeconds, labelKey: FRESHNESS_LABEL[state] };
}

// ─── Estado visible de la conexión del directo (#286) ──────────────────────
/**
 * Mientras el partido está en vivo, la cabecera sólo tenía un microtexto
 * ("· reconectando") para avisar de problemas de conexión. Esta función pura
 * combina el transporte SSE, el aviso de poll caído del hub (#284) y la
 * frescura de los datos para decidir un estado visible y comprobable sin
 * navegador.
 *
 * - `connecting`:  abriendo el stream (o reconectando tras un corte de duración).
 * - `reconnecting`: el transporte dio error; EventSource reintenta solo.
 * - `weak`:       el stream vive pero los datos llegan tarde o el hub falló.
 * - `live`:       todo en orden (no se muestra nada).
 */
export type ConnectionState = 'live' | 'connecting' | 'reconnecting' | 'weak';

/** Clave i18n del texto a mostrar para cada estado distinto de `live`. */
export const CONNECTION_LABEL: Record<Exclude<ConnectionState, 'live'>, string> = {
  connecting:   'match_detail.connecting',
  reconnecting: 'match_detail.reconnecting_short',
  weak:         'match_detail.signal_weak',
};

export function connectionState(
  sseStatus: string | undefined,
  serverStale: boolean,
  freshness: Freshness | null,
): ConnectionState {
  if (sseStatus === 'error') return 'reconnecting';
  if (sseStatus === 'connecting') return 'connecting';
  if (serverStale || (freshness != null && freshness.state !== 'fresh')) return 'weak';
  return 'live';
}

export function injectAccumulatedFouls(events: MatchEvent[], homeTeamId: string): TimelineEvent[] {
  const result: TimelineEvent[] = [];
  let homeFouls = 0;
  let awayFouls = 0;

  // Base del conteo: eventos 'foul' reales (ficha) si existen;
  // fallback legacy a tarjetas azules para partidos scrapeados antes.
  const hasRealFouls = events.some((e) => e.eventType === 'foul');
  const countableType = hasRealFouls ? 'foul' : 'blue_card';

  for (const ev of events) {
    // Las faltas individuales SÍ se pintan (de forma compacta, con su autor)
    // y además generan las marcas de acumulación 10ª/15ª... (falta directa).
    result.push(ev);
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

// ─── Orden del timeline (#285) ─────────────────────────────────────────────
/**
 * Crono del acta en SEGUNDOS RESTANTES. El scraper lo guarda ya como "MM:SS"
 * (cuenta atrás, siempre con minutos a dos cifras), de modo que comparar en
 * segundos evita depender del relleno al ordenar. Devuelve null si no hay un
 * crono parseable, para poder caer al minuto como fallback.
 */
export function clockRemainingSeconds(clock: string | null | undefined): number | null {
  if (!clock) return null;
  const m = /^(\d{1,3}):(\d{2})$/.exec(clock.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Orden del timeline (#285): periodo ascendente; después crono RESTANTE
 * descendente (a mayor restante, antes ocurrió) y el minuto ascendente como
 * fallback cuando no hay crono. Es la réplica en cliente del ORDER BY de la
 * API, para que el relato no dependa de que el backend esté al día. `sort` es
 * estable, así que los empates conservan el orden de llegada (p. ej. mismo
 * crono: causa antes que efecto).
 */
export function compareTimelineEvents(
  a: Pick<MatchEvent, 'period' | 'minute' | 'clock'>,
  b: Pick<MatchEvent, 'period' | 'minute' | 'clock'>,
): number {
  const periodA = a.period ?? 99;
  const periodB = b.period ?? 99;
  if (periodA !== periodB) return periodA - periodB;

  const clockA = clockRemainingSeconds(a.clock);
  const clockB = clockRemainingSeconds(b.clock);
  if (clockA != null && clockB != null) {
    if (clockA !== clockB) return clockB - clockA; // más restante → antes
  } else if (clockA != null) {
    return -1; // con crono va antes que sin crono
  } else if (clockB != null) {
    return 1;
  }

  return (a.minute ?? 9999) - (b.minute ?? 9999);
}

// ─── Evento a anunciar a lectores de pantalla (#287) ───────────────────────
/** Tipos con señal de producto suficiente para anunciar; el resto es ruido. */
const ANNOUNCEABLE_EVENTS = new Set(['goal', 'penalty', 'blue_card', 'red_card', 'direct_foul', 'timeout']);

/**
 * El evento más reciente que merece anunciarse por la región `aria-live`
 * (#287). Ignora los eventos virtuales del pintado (divisores de periodo y
 * avisos de falta acumulada), que no aportan información nueva, y las faltas
 * sueltas. Función pura, testeable sin navegador.
 */
export function latestAnnounceableEvent<T extends { eventType: string }>(events: readonly T[]): T | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ANNOUNCEABLE_EVENTS.has(ev.eventType)) return ev;
  }
  return null;
}
