import { describe, it, expect } from 'vitest';
import {
  freshnessState,
  FRESH_MAX_MS,
  STALE_MAX_MS,
  clockRemainingSeconds,
  compareTimelineEvents,
  connectionState,
  latestAnnounceableEvent,
  isNewerSnapshot,
  reconnectDelayMs,
  shouldRecreateEventSource,
  shouldPollFallback,
  SSE_RECONNECT_BASE_MS,
  SSE_RECONNECT_MAX_MS,
  SSE_RECONNECT_MAX_ERRORS,
} from './timeline-model';

/**
 * Indicador de frescura del directo (#284). Función pura: decide si el marcador
 * está fresco, en posible desfase o sin señal, a partir del instante de la
 * última actualización. Sin navegador.
 */
describe('freshnessState', () => {
  const now = 1_000_000_000_000;

  it('recién actualizado → fresh con el texto de segundos', () => {
    const f = freshnessState(now - 3_000, now);
    expect(f.state).toBe('fresh');
    expect(f.ageSeconds).toBe(3);
    expect(f.labelKey).toBe('match_detail.freshness_fresh');
  });

  it('justo en el límite de fresh (< FRESH_MAX_MS)', () => {
    expect(freshnessState(now - (FRESH_MAX_MS - 1), now).state).toBe('fresh');
    expect(freshnessState(now - FRESH_MAX_MS, now).state).toBe('stale');
  });

  it('sin actualizaciones recientes → stale (posible desfase)', () => {
    const f = freshnessState(now - 60_000, now);
    expect(f.state).toBe('stale');
    expect(f.ageSeconds).toBe(60);
    expect(f.labelKey).toBe('match_detail.freshness_stale');
  });

  it('pasado el umbral alto → down (sin señal)', () => {
    const f = freshnessState(now - (STALE_MAX_MS + 1), now);
    expect(f.state).toBe('down');
    expect(f.labelKey).toBe('match_detail.freshness_down');
  });

  it('sin ninguna actualización (null) → down', () => {
    expect(freshnessState(null, now).state).toBe('down');
  });

  it('relojes desincronizados (last en el futuro) → age 0 y fresh', () => {
    const f = freshnessState(now + 5_000, now);
    expect(f.ageSeconds).toBe(0);
    expect(f.state).toBe('fresh');
  });

  it('el aviso del servidor (poll fallido) degrada fresh → stale', () => {
    const f = freshnessState(now - 1_000, now, true);
    expect(f.state).toBe('stale');
    expect(f.labelKey).toBe('match_detail.freshness_stale');
  });

  it('el aviso del servidor no "mejora" un down a stale', () => {
    expect(freshnessState(now - (STALE_MAX_MS + 1), now, true).state).toBe('down');
  });
});

/**
 * #285: orden del timeline. El crono del acta es cuenta atrás MM:SS; a mayor
 * restante, antes ocurrió. El minuto sólo es fallback cuando no hay crono.
 */
describe('clockRemainingSeconds', () => {
  it('parses MM:SS to remaining seconds', () => {
    expect(clockRemainingSeconds('07:54')).toBe(474);
    expect(clockRemainingSeconds('00:00')).toBe(0);
    expect(clockRemainingSeconds('25:00')).toBe(1500);
  });

  it('tolerates non zero-padded minutes', () => {
    expect(clockRemainingSeconds('7:54')).toBe(474);
  });

  it('returns null when there is no parseable clock', () => {
    expect(clockRemainingSeconds(null)).toBeNull();
    expect(clockRemainingSeconds(undefined)).toBeNull();
    expect(clockRemainingSeconds('')).toBeNull();
    expect(clockRemainingSeconds('abc')).toBeNull();
    expect(clockRemainingSeconds('12')).toBeNull();
  });
});

describe('compareTimelineEvents', () => {
  const ev = (
    period: number | null,
    minute: number | null,
    clock: string | null,
  ) => ({ period, minute, clock });

  it('dentro del mismo minuto ordena por crono restante DESC', () => {
    const earlier = ev(2, 18, '07:54'); // más restante → antes
    const later   = ev(2, 18, '07:16');
    expect(compareTimelineEvents(earlier, later)).toBeLessThan(0);
    expect(compareTimelineEvents(later, earlier)).toBeGreaterThan(0);
    expect(compareTimelineEvents(earlier, earlier)).toBe(0);
  });

  it('el crono manda sobre el minuto cuando discrepan', () => {
    const a = ev(2, 30, '08:00'); // minuto mayor pero crono más alto
    const b = ev(2, 1,  '07:00');
    expect(compareTimelineEvents(a, b)).toBeLessThan(0);
  });

  it('sin crono, usa el minuto ascendente como fallback', () => {
    const a = ev(1, 5, null);
    const b = ev(1, 7, null);
    expect(compareTimelineEvents(a, b)).toBeLessThan(0);
  });

  it('los eventos con crono van antes que los que no lo tienen', () => {
    const withClock = ev(2, null, '10:00');
    const without   = ev(2, 3, null);
    expect(compareTimelineEvents(withClock, without)).toBeLessThan(0);
    expect(compareTimelineEvents(without, withClock)).toBeGreaterThan(0);
  });

  it('ordena por periodo antes que por crono', () => {
    expect(compareTimelineEvents(ev(1, 24, '01:00'), ev(2, 1, '24:00'))).toBeLessThan(0);
  });

  it('ordena un array completo como el relato del partido', () => {
    const events = [ev(2, 18, '07:16'), ev(1, 5, null), ev(2, 18, '07:54'), ev(1, 6, null)];
    const sorted = [...events].sort(compareTimelineEvents);
    expect(sorted).toEqual([ev(1, 5, null), ev(1, 6, null), ev(2, 18, '07:54'), ev(2, 18, '07:16')]);
  });
});

/**
 * #286: estado visible de la conexión del directo, a partir del transporte SSE
 * y del aviso de frescura. Función pura: sin navegador.
 */
describe('connectionState', () => {
  const fresh = { state: 'fresh', ageSeconds: 2, labelKey: 'match_detail.freshness_fresh' } as const;
  const stale = { state: 'stale', ageSeconds: 60, labelKey: 'match_detail.freshness_stale' } as const;
  const down  = { state: 'down', ageSeconds: 200, labelKey: 'match_detail.freshness_down' } as const;

  it('error de SSE → reconnecting', () => {
    expect(connectionState('error', false, fresh)).toBe('reconnecting');
  });

  it('SSE abriendo → connecting', () => {
    expect(connectionState('connecting', false, fresh)).toBe('connecting');
  });

  it('el error de SSE gana sobre la frescura', () => {
    expect(connectionState('error', true, down)).toBe('reconnecting');
    expect(connectionState('connecting', true, down)).toBe('connecting');
  });

  it('poll del hub caído → weak', () => {
    expect(connectionState('live', true, fresh)).toBe('weak');
  });

  it('sin actualizaciones recientes → weak', () => {
    expect(connectionState('live', false, stale)).toBe('weak');
    expect(connectionState('live', false, down)).toBe('weak');
  });

  it('todo en orden → live', () => {
    expect(connectionState('live', false, fresh)).toBe('live');
    expect(connectionState('live', false, null)).toBe('live');
    expect(connectionState(undefined, false, null)).toBe('live');
  });
});

/**
 * #287: selector del evento a anunciar por la región aria-live. Debe ser el más
 * reciente con señal de producto (gol, tarjeta, etc.), ignorando los eventos
 * virtuales del pintado (divisores y avisos de falta acumulada) y las faltas
 * sueltas, que sólo generarían ruido.
 */
describe('latestAnnounceableEvent', () => {
  const e = (id: string, eventType: string) => ({ id, eventType });

  it('sin eventos → null', () => {
    expect(latestAnnounceableEvent([])).toBeNull();
  });

  it('devuelve el evento anunciable más reciente', () => {
    const events = [e('1', 'foul'), e('2', 'goal'), e('3', 'accumulated_foul'), e('4', 'period_divider')];
    expect(latestAnnounceableEvent(events)?.id).toBe('2');
  });

  it('ignora los eventos virtuales del pintado', () => {
    expect(latestAnnounceableEvent([e('1', 'period_divider'), e('2', 'accumulated_foul')])).toBeNull();
    expect(latestAnnounceableEvent([e('3', 'period_end')])).toBeNull();
  });

  it('un gol posterior a una falta sí se anuncia', () => {
    const events = [e('1', 'goal'), e('2', 'foul'), e('3', 'goal')];
    expect(latestAnnounceableEvent(events)?.id).toBe('3');
  });
});

/**
 * #369/#376: protección anti-stale en cliente. El servidor firma cada snapshot
 * con `updatedAt`; un poll concurrente o un respaldo con caché podría entregar
 * uno MÁS ANTIGUO después de uno nuevo. Esta función pura decide si aplicarlo.
 */
describe('isNewerSnapshot', () => {
  it('acepta el primero cuando no hay referencia previa', () => {
    expect(isNewerSnapshot(null, 1_000)).toBe(true);
  });

  it('acepta uno igual o más nuevo (idempotente)', () => {
    expect(isNewerSnapshot(1_000, 1_000)).toBe(true);
    expect(isNewerSnapshot(1_000, 1_001)).toBe(true);
  });

  it('descarta uno más viejo (fuera de orden)', () => {
    expect(isNewerSnapshot(1_000, 999)).toBe(false);
  });

  it('acepta si el updatedAt entrante no es parseable (cae a hora de recepción)', () => {
    expect(isNewerSnapshot(1_000, Number.NaN)).toBe(true);
  });
});

/**
 * #371: reconexión del directo. Sin `retry:` ni backoff, tras un reinicio todo
 * el parque reconecta a la vez (herd). `reconnectDelayMs` aplica backoff
 * exponencial con jitter; el `random` se inyecta para testear sin azar.
 */
describe('reconnectDelayMs', () => {
  it('crece exponencialmente desde la base', () => {
    expect(reconnectDelayMs(0, () => 1)).toBe(SSE_RECONNECT_BASE_MS);
    expect(reconnectDelayMs(1, () => 1)).toBe(SSE_RECONNECT_BASE_MS * 2);
    expect(reconnectDelayMs(2, () => 1)).toBe(SSE_RECONNECT_BASE_MS * 4);
  });

  it('respeta el tope máximo', () => {
    expect(reconnectDelayMs(99, () => 1)).toBe(SSE_RECONNECT_MAX_MS);
  });

  it('aplica jitter entre el 50% y el 100% del retardo (desincroniza el herd)', () => {
    expect(reconnectDelayMs(3, () => 0)).toBe(SSE_RECONNECT_BASE_MS * 4); // 50%
    expect(reconnectDelayMs(3, () => 1)).toBe(SSE_RECONNECT_BASE_MS * 8); // 100%
  });

  it('tolera intentos negativos sin producir retardos negativos', () => {
    expect(reconnectDelayMs(-5, () => 0)).toBe(SSE_RECONNECT_BASE_MS / 2);
  });
});

/**
 * #371: un HTTP ≠ 200 (p. ej. el 503 del limitador de conexiones) deja el
 * EventSource CLOSED y el navegador NO reintenta. Esta función decide cuándo
 * hay que recrearlo en vez de confiar en su auto-reintento.
 */
describe('shouldRecreateEventSource', () => {
  it('recrea cuando el EventSource está CLOSED (no auto-reintenta)', () => {
    expect(shouldRecreateEventSource(2, 1)).toBe(true);
  });

  it('deja que EventSource reintente mientras está CONNECTING y hay pocos errores', () => {
    expect(shouldRecreateEventSource(0, 1)).toBe(false);
    expect(shouldRecreateEventSource(0, SSE_RECONNECT_MAX_ERRORS - 1)).toBe(false);
  });

  it('recrea tras N errores consecutivos (aunque siga CONNECTING)', () => {
    expect(shouldRecreateEventSource(0, SSE_RECONNECT_MAX_ERRORS)).toBe(true);
  });
});

/**
 * #369: si el hub está ciego pero el transporte SSE sigue "live", el cliente
 * debe reactivar el polling REST de respaldo en vez de quedarse congelado.
 */
describe('shouldPollFallback', () => {
  const fresh = { state: 'fresh', ageSeconds: 2, labelKey: 'match_detail.freshness_fresh' } as const;
  const stale = { state: 'stale', ageSeconds: 60, labelKey: 'match_detail.freshness_stale' } as const;
  const down  = { state: 'down', ageSeconds: 200, labelKey: 'match_detail.freshness_down' } as const;

  it('SSE live y datos frescos → no sondea (no duplica carga)', () => {
    expect(shouldPollFallback('live', false, fresh)).toBe(false);
  });

  it('SSE live pero el hub avisó de poll caído → sondea', () => {
    expect(shouldPollFallback('live', true, fresh)).toBe(true);
  });

  it('SSE live pero datos envejecidos → sondea', () => {
    expect(shouldPollFallback('live', false, stale)).toBe(true);
    expect(shouldPollFallback('live', false, down)).toBe(true);
  });

  it('sin SSE (conectando/error/idle) → sondea siempre', () => {
    expect(shouldPollFallback('connecting', false, fresh)).toBe(true);
    expect(shouldPollFallback('error', false, null)).toBe(true);
    expect(shouldPollFallback(undefined, false, null)).toBe(true);
  });
});
