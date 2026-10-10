import { describe, it, expect } from 'vitest';
import { applySnapshot, emptyHubState, eventForKind, enqueueBounded, SSE_NOT_FOUND_ERROR } from './sse-hub.js';
import type { HubSnapshotInput } from './sse-hub.js';

interface SnapOverrides {
  status?: string;
  home?: number | null;
  away?: number | null;
  events?: number;
  period?: number | null;
  isHalftime?: boolean;
}

function snap(o: SnapOverrides = {}): HubSnapshotInput {
  return {
    match: {
      status: o.status ?? 'live',
      score: { home: o.home ?? 0, away: o.away ?? 0 },
      live:
        o.period === undefined && o.isHalftime === undefined
          ? null
          : { period: o.period ?? null, isHalftime: o.isHalftime ?? false },
    },
    events: Array.from({ length: o.events ?? 0 }, (_, i) => ({ id: i })),
  };
}

describe('applySnapshot', () => {
  it('el primer snapshot siempre se emite', () => {
    const diff = applySnapshot(emptyHubState(), snap({ events: 2, home: 1 }));
    expect(diff.changed).toBe(true);
    expect(diff.state.lastEventCount).toBe(2);
    expect(diff.state.lastSnapshotJson).toBe(diff.json);
  });

  it('un snapshot idéntico no se reemite (evita fan-out ruidoso)', () => {
    const first = applySnapshot(emptyHubState(), snap({ events: 2, home: 1 }));
    const second = applySnapshot(first.state, snap({ events: 2, home: 1 }));
    expect(second.changed).toBe(false);
  });

  it('una corrección de acta (mismo conteo y marcador, distinto contenido) se emite', () => {
    const first = applySnapshot(emptyHubState(), snap({ events: 2, home: 1 }));
    // La fuente sustituye un evento por otro en el mismo ciclo: el nº de eventos
    // y el marcador no cambian, pero el listado sí.
    const corrected: HubSnapshotInput = {
      match: { status: 'live', score: { home: 1, away: 0 }, live: null },
      events: [{ id: 0 }, { id: 99 }],
    };
    expect(applySnapshot(first.state, corrected).changed).toBe(true);
  });

  it('un gol nuevo (eventos + marcador) se emite', () => {
    const first = applySnapshot(emptyHubState(), snap({ events: 2, home: 1, away: 0 }));
    const second = applySnapshot(first.state, snap({ events: 3, home: 2, away: 0 }));
    expect(second.changed).toBe(true);
  });

  it('solo cambia el marcador → se emite', () => {
    const first = applySnapshot(emptyHubState(), snap({ events: 1, home: 1, away: 0 }));
    const second = applySnapshot(first.state, snap({ events: 1, home: 1, away: 1 }));
    expect(second.changed).toBe(true);
  });

  it('solo cambia la fase (periodo) → se emite', () => {
    const first = applySnapshot(emptyHubState(), snap({ events: 1, period: 1 }));
    const second = applySnapshot(first.state, snap({ events: 1, period: 2 }));
    expect(second.changed).toBe(true);
  });

  it('el descanso (isHalftime) cuenta como cambio de fase', () => {
    const first = applySnapshot(emptyHubState(), snap({ events: 1, period: 1, isHalftime: false }));
    const second = applySnapshot(first.state, snap({ events: 1, period: 1, isHalftime: true }));
    expect(second.changed).toBe(true);
  });

  it('el paso scheduled→live (estado de la fuente) cuenta como fase', () => {
    const first = applySnapshot(emptyHubState(), snap({ status: 'scheduled', events: 0 }));
    const second = applySnapshot(first.state, snap({ status: 'live', events: 0 }));
    expect(second.changed).toBe(true);
  });

  it('marca eventsChanged sólo cuando cambia el listado de eventos (#376)', () => {
    const first = applySnapshot(emptyHubState(), snap({ events: 1 }));
    const second = applySnapshot(first.state, snap({ events: 2 }));
    expect(second.eventsChanged).toBe(true);
    const third = applySnapshot(second.state, snap({ events: 2 }));
    expect(third.eventsChanged).toBe(false);
  });

  it('una corrección de alineaciones (asistencia nueva) se emite (#376)', () => {
    const withLineups = (assists: number): HubSnapshotInput => ({
      match: { status: 'live', score: { home: 1, away: 0 }, live: null },
      events: [{ id: 0 }],
      lineups: { home: [{ player: 'A', assists }], away: [] },
    });
    const first = applySnapshot(emptyHubState(), withLineups(0));
    const second = applySnapshot(first.state, withLineups(1));
    expect(second.changed).toBe(true);
  });
});

describe('eventForKind', () => {
  it('el primer data es snapshot; los siguientes update', () => {
    const first = eventForKind('data', false);
    expect(first).toEqual({ event: 'snapshot', firstSent: true });
    expect(eventForKind('data', first.firstSent)).toEqual({ event: 'update', firstSent: true });
  });

  it('finished y error pasan con su nombre sin tocar firstSent', () => {
    expect(eventForKind('finished', true)).toEqual({ event: 'finished', firstSent: true });
    expect(eventForKind('error', false)).toEqual({ event: 'error', firstSent: false });
  });
});

describe('enqueueBounded (#333)', () => {
  it('encola normalmente por debajo del tope', () => {
    const q: number[] = [];
    enqueueBounded(q, 1, 3);
    enqueueBounded(q, 2, 3);
    expect(q).toEqual([1, 2]);
  });

  it('al tope descarta el más antiguo y conserva el nuevo', () => {
    const q: number[] = [1, 2, 3];
    enqueueBounded(q, 4, 3);
    expect(q).toEqual([2, 3, 4]);
  });

  it('tolera colas ya por encima del tope', () => {
    const q: number[] = [1, 2, 3, 4, 5];
    enqueueBounded(q, 6, 2);
    expect(q).toEqual([5, 6]);
  });
});

describe('SSE_NOT_FOUND_ERROR (#333)', () => {
  it('unifica la forma de error con el resto de la API', () => {
    expect(SSE_NOT_FOUND_ERROR).toEqual({ error: 'not_found', message: 'Partido no encontrado' });
  });
});
