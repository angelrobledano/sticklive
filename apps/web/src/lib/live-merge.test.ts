import { describe, it, expect } from 'vitest';
import { mergeMatchList, patchWithLive, shouldReconcile } from './live-merge';
import type { Match } from '@/lib/api/client';

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: 'm1',
    seasonId: 's1',
    roundId: null,
    status: 'scheduled',
    scheduledAt: '2026-10-19T18:00:00Z',
    startedAt: null,
    finishedAt: null,
    score: { home: null, away: null },
    venue: null,
    homeTeamId: 'home',
    awayTeamId: 'away',
    homeTeam: { id: 'home', name: 'Home', shortName: 'HOM', logoUrl: null },
    awayTeam: { id: 'away', name: 'Away', shortName: 'AWY', logoUrl: null },
    sourceRef: null,
    ...overrides,
  };
}

describe('mergeMatchList', () => {
  it('devuelve la misma referencia cuando nada cambió', () => {
    const previous = [match()];
    const next = [match()];
    expect(mergeMatchList(previous, next)).toBe(previous);
  });

  it('reutiliza los partidos intactos y solo sustituye el que cambió', () => {
    const first = match({ id: 'm1' });
    const second = match({ id: 'm2' });
    const nextSecond = match({ id: 'm2', status: 'live', score: { home: 1, away: 0 } });

    const merged = mergeMatchList([first, second], [match({ id: 'm1' }), nextSecond]);

    expect(merged[0]).toBe(first);
    expect(merged[1]).toBe(nextSecond);
  });

  it('detecta altas y bajas', () => {
    const first = match({ id: 'm1' });
    const second = match({ id: 'm2' });

    expect(mergeMatchList([first], [first, second])).toHaveLength(2);
    expect(mergeMatchList([first, second], [first])).toHaveLength(1);
  });

  it('reutiliza los objetos aunque cambie el orden', () => {
    const first = match({ id: 'm1' });
    const second = match({ id: 'm2' });
    const merged = mergeMatchList([first, second], [second, first]);

    expect(merged[0]).toBe(second);
    expect(merged[1]).toBe(first);
  });
});

/**
 * Polling ligero de la home: se pide /matches/live (2 KB) y no el listado
 * completo (~478 KB). Solo se parchean los partidos ya conocidos; lo que el
 * feed de directos no puede contar (un final, un directo nuevo que no está en
 * la lista) pide reconciliar con el listado completo.
 */
describe('patchWithLive', () => {
  it('actualiza el marcador de un partido en directo conocido', () => {
    const prev = [match({ id: 'a', status: 'live', score: { home: 0, away: 0 } }), match({ id: 'b' })];
    const live = [match({ id: 'a', status: 'live', score: { home: 1, away: 0 } })];
    const r = patchWithLive(prev, live);
    expect(r.matches[0]!.score).toEqual({ home: 1, away: 0 });
    expect(r.matches[1]).toBe(prev[1]);
    expect(r.needsReconcile).toBe(false);
  });

  it('marca el inicio: un programado que aparece en directo', () => {
    const prev = [match({ id: 'a', status: 'scheduled' })];
    const r = patchWithLive(prev, [match({ id: 'a', status: 'live', score: { home: 0, away: 0 } })]);
    expect(r.matches[0]!.status).toBe('live');
    expect(r.needsReconcile).toBe(false);
  });

  it('sin cambios devuelve la misma referencia', () => {
    const prev = [match({ id: 'a', status: 'live', score: { home: 2, away: 1 } })];
    const r = patchWithLive(prev, [match({ id: 'a', status: 'live', score: { home: 2, away: 1 } })]);
    expect(r.matches).toBe(prev);
    expect(r.needsReconcile).toBe(false);
  });

  it('un directo que desaparece del feed (ha terminado) pide reconciliar y no se inventa el final', () => {
    const prev = [match({ id: 'a', status: 'live', score: { home: 3, away: 2 } })];
    const r = patchWithLive(prev, []);
    expect(r.matches).toBe(prev);
    expect(r.needsReconcile).toBe(true);
  });

  it('un directo que no está en la lista pide reconciliar y no se añade a ciegas', () => {
    const prev = [match({ id: 'a' })];
    const r = patchWithLive(prev, [match({ id: 'z', status: 'live' })]);
    expect(r.matches).toBe(prev);
    expect(r.needsReconcile).toBe(true);
  });
});

describe('shouldReconcile', () => {
  const MIN = 60_000;
  it('reconcilia si el feed lo pide y ha pasado el mínimo', () => {
    expect(shouldReconcile(true, 0, MIN)).toBe(true);
  });
  it('no reconcilia en ráfaga aunque el feed lo pida', () => {
    expect(shouldReconcile(true, 0, 30_000)).toBe(false);
  });
  it('reconcilia por seguridad cada 5 min aunque nada lo pida', () => {
    expect(shouldReconcile(false, 0, 4 * MIN)).toBe(false);
    expect(shouldReconcile(false, 0, 5 * MIN)).toBe(true);
  });
});
