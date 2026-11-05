import { describe, expect, it } from 'vitest';
import type { MatchDetailRaw } from '@sports/core/api';
import {
  applyStreamPatch,
  backoffDelay,
  type MatchState,
} from './match-stream';

// Fixture mínimo con TODOS los campos del MatchDetailRaw real (espejo de MatchDto,
// apps/api/src/lib/match-dto.ts:135-166).
const EMPTY_STATS: MatchDetailRaw['stats'] = {
  homeFouls: 0,
  awayFouls: 0,
  homeGoals: 0,
  awayGoals: 0,
  homeAssists: 0,
  awayAssists: 0,
  homeBlueCards: 0,
  awayBlueCards: 0,
  homeRedCards: 0,
  awayRedCards: 0,
  homeTimeouts: 0,
  awayTimeouts: 0,
  homeDirectFouls: { total: 0, scored: 0 },
  awayDirectFouls: { total: 0, scored: 0 },
  homePenalties: { total: 0, scored: 0 },
  awayPenalties: { total: 0, scored: 0 },
};

const team = (id: string): MatchDetailRaw['match']['homeTeam'] => ({
  id,
  name: `Equipo ${id}`,
  shortName: id.toUpperCase(),
  logoUrl: null,
});

const event = (id: string, minute: number | null): MatchDetailRaw['events'][number] => ({
  id,
  eventType: 'goal',
  minute,
  period: 1,
  clock: null,
  teamId: 'h',
  isHomeTeam: true,
  detail: null,
  player: null,
});

function mkDetail(
  over: { score?: { home: number | null; away: number | null }; events?: MatchDetailRaw['events'] } = {},
): MatchDetailRaw {
  return {
    match: {
      id: 'm1',
      seasonId: 's1',
      roundId: null,
      competitionId: null,
      competitionName: 'Liga',
      competitionSlug: null,
      competitionTimezone: null,
      status: 'live',
      eventCoverage: 'full',
      scheduledAt: null,
      startedAt: null,
      finishedAt: null,
      score: over.score ?? { home: 0, away: 0 },
      winType: null,
      winnerTeamId: null,
      regulation: null,
      penalties: null,
      penaltyShootout: null,
      venue: null,
      referee: null,
      sourceRef: null,
      videoUrl: null,
      live: null,
      homeTeam: team('h'),
      awayTeam: team('a'),
    },
    events: over.events ?? [],
    stats: EMPTY_STATS,
    lineups: { home: [], away: [] },
  };
}

const base: MatchState = { detail: null, connected: false, transport: 'sse', stale: false, staleAt: null };

describe('backoffDelay', () => {
  it('crece exponencialmente y se topa en 30s', () => {
    expect(backoffDelay(0)).toBe(1000);
    expect(backoffDelay(1)).toBe(2000);
    expect(backoffDelay(2)).toBe(4000);
    expect(backoffDelay(10)).toBe(30_000);
  });
});

describe('applyStreamPatch', () => {
  it('snapshot reemplaza el detail y marca conectado', () => {
    const detail = mkDetail();
    const next = applyStreamPatch(base, { kind: 'snapshot', detail });
    expect(next.detail).toBe(detail);
    expect(next.connected).toBe(true);
  });

  // Protocolo REAL del API: cada `update` reenvía el DTO COMPLETO (el hub
  // serializa el snapshot entero, apps/api/src/lib/sse-hub.ts:97), también
  // cuando una corrección de acta sustituye un evento por otro (#177). Por eso
  // el reemplazo es en bloque: un merge por id congelaría el evento corregido.
  it('update reemplaza el DTO completo: refleja el marcador, eventos nuevos y correcciones', () => {
    let state = applyStreamPatch(base, {
      kind: 'snapshot',
      detail: mkDetail({ events: [event('e1', 10)] }),
    });
    state = applyStreamPatch(state, {
      kind: 'update',
      detail: mkDetail({
        score: { home: 1, away: 0 },
        events: [event('e1', 12), event('e2', 25)],
      }),
    });
    expect(state.detail?.match.score.home).toBe(1);
    expect(state.detail?.events.map((e) => `${e.id}:${e.minute}`)).toEqual(['e1:12', 'e2:25']);
    expect(state.connected).toBe(true);
  });

  it('update sin snapshot previo también fija el detalle (el payload es completo)', () => {
    const detail = mkDetail();
    const next = applyStreamPatch(base, { kind: 'update', detail });
    expect(next.detail).toBe(detail);
    expect(next.connected).toBe(true);
  });

  // Corrección de acta que SUSTITUYE el evento por otro id (#177): con el
  // reemplazo en bloque el id antiguo desaparece; un merge por id lo dejaría
  // huérfano junto al nuevo.
  it('update sustituye un evento corregido (#177): el id antiguo desaparece', () => {
    let state = applyStreamPatch(base, {
      kind: 'snapshot',
      detail: mkDetail({ events: [event('e1', 10)] }),
    });
    state = applyStreamPatch(state, {
      kind: 'update',
      detail: mkDetail({ events: [event('e9', 10)] }),
    });
    expect(state.detail?.events.map((e) => e.id)).toEqual(['e9']);
  });

  it('transport degrada a poll y desconecta conservando el último detalle', () => {
    let state = applyStreamPatch(base, { kind: 'snapshot', detail: mkDetail() });
    state = applyStreamPatch(state, { kind: 'transport', transport: 'poll' });
    expect(state.transport).toBe('poll');
    expect(state.connected).toBe(false);
    expect(state.detail).not.toBeNull();
  });

  // Task 5.2 (backlog #5): el hub emite `event: stale` cuando su poll falla
  // (#284). El patch marca el desfase conservando el detalle y la conexión
  // (el SSE sigue abierto: lo que está congelado son los DATOS, no el canal).
  it('stale marca el desfase con su instante y conserva detalle y conexión', () => {
    let state = applyStreamPatch(base, { kind: 'snapshot', detail: mkDetail() });
    state = applyStreamPatch(state, { kind: 'stale', staleAt: 1_234 });
    expect(state.stale).toBe(true);
    expect(state.staleAt).toBe(1_234);
    expect(state.detail).not.toBeNull();
    expect(state.connected).toBe(true);
  });

  // Cualquier snapshot/update posterior significa datos frescos: limpia el
  // desfase. El `stale: false` de recuperación se ignora; si llega sin fanout
  // (recuperación sin cambios de datos), el flag persiste hasta el próximo
  // snapshot/update o re-enfoque.
  it('snapshot y update posteriores limpian el desfase', () => {
    let state = applyStreamPatch(base, { kind: 'stale', staleAt: 1_234 });
    state = applyStreamPatch(state, { kind: 'snapshot', detail: mkDetail() });
    expect(state.stale).toBe(false);
    expect(state.staleAt).toBeNull();
    state = applyStreamPatch(state, { kind: 'stale', staleAt: 5_678 });
    state = applyStreamPatch(state, { kind: 'update', detail: mkDetail() });
    expect(state.stale).toBe(false);
    expect(state.staleAt).toBeNull();
  });
});
