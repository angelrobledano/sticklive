import { describe, it, expect } from 'vitest';
import { upsertRecent, parseRecents, RECENTS_LIMIT, type RecentMatch } from './recents';

/**
 * #270: historial local de partidos vistos. La lógica de la lista (alta,
 * deduplicación por partido, orden del más reciente y límite) es PURA para
 * poder fijarla con tests sin tocar localStorage.
 */
function rec(id: string, viewedAt = 0): RecentMatch {
  return {
    id,
    homeTeamId: `h-${id}`,
    awayTeamId: `a-${id}`,
    homeName: `Local ${id}`,
    awayName: `Visitante ${id}`,
    competitionId: 'c1',
    competitionName: 'Liga',
    viewedAt,
  };
}

describe('upsertRecent — alta y orden', () => {
  it('añade los partidos nuevos al principio (más reciente primero)', () => {
    const next = upsertRecent([rec('a', 1)], rec('b', 2));
    expect(next.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('deduplica por id moviendo el repetido al frente y actualizando su marca', () => {
    const list = [rec('a', 1), rec('b', 2), rec('c', 3)];
    const next = upsertRecent(list, rec('b', 4));
    expect(next.map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(next[0]!.viewedAt).toBe(4);
    // No debe quedar una copia antigua de 'b'.
    expect(next.filter((r) => r.id === 'b')).toHaveLength(1);
  });

  it('no muta la lista original', () => {
    const list = [rec('a', 1)];
    upsertRecent(list, rec('b', 2));
    expect(list.map((r) => r.id)).toEqual(['a']);
  });
});

describe('upsertRecent — límite', () => {
  it('respeta el límite por defecto descartando los más antiguos', () => {
    const list = Array.from({ length: RECENTS_LIMIT }, (_, i) => rec(`t${i}`, i));
    const next = upsertRecent(list, rec('nuevo', 99));
    expect(next).toHaveLength(RECENTS_LIMIT);
    expect(next[0]!.id).toBe('nuevo');
    expect(next.some((r) => r.id === `t${RECENTS_LIMIT - 1}`)).toBe(false);
  });

  it('acepta un límite explícito', () => {
    const next = upsertRecent([rec('a'), rec('b')], rec('c'), 2);
    expect(next.map((r) => r.id)).toEqual(['c', 'a']);
  });
});

describe('parseRecents — lectura defensiva', () => {
  it('devuelve [] para null, JSON inválido o estructura que no es lista', () => {
    expect(parseRecents(null)).toEqual([]);
    expect(parseRecents('')).toEqual([]);
    expect(parseRecents('no-json')).toEqual([]);
    expect(parseRecents('{"a":1}')).toEqual([]);
  });

  it('parsea una lista válida', () => {
    const list = [rec('a', 1), rec('b', 2)];
    expect(parseRecents(JSON.stringify(list))).toEqual(list);
  });

  it('descarta entradas con forma inválida y conserva las válidas', () => {
    const raw = JSON.stringify([rec('a', 1), { id: 'b' }, null, 'x', 42, rec('c', 2)]);
    expect(parseRecents(raw).map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('acepta competición nula', () => {
    const item = { ...rec('a', 1), competitionId: null, competitionName: null };
    expect(parseRecents(JSON.stringify([item]))).toEqual([item]);
  });
});
