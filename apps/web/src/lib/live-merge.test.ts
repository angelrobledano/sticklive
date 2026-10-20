import { describe, it, expect } from 'vitest';
import { mergeMatchList } from './live-merge';
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
