import { describe, it, expect } from 'vitest';
import { dayFetchRange, mergeById, windowFromDays, nextDayWithMatches } from './home-loading';

describe('dayFetchRange', () => {
  it('cubre el día local de cualquier zona con el rango UTC [d-1, d+1]', () => {
    expect(dayFetchRange('2026-10-25')).toEqual({ from: '2026-10-24', to: '2026-10-26' });
  });
  it('cruza mes y año', () => {
    expect(dayFetchRange('2027-01-01')).toEqual({ from: '2026-12-31', to: '2027-01-02' });
  });
});

describe('mergeById', () => {
  const a = { id: 'a', v: 1 };
  const b = { id: 'b', v: 1 };
  it('une sin perder los partidos de otros días', () => {
    const r = mergeById([a], [b]);
    expect(r.map((m) => m.id)).toEqual(['a', 'b']);
  });
  it('actualiza los que cambian y conserva la identidad de los iguales', () => {
    const r = mergeById([a, b], [{ id: 'a', v: 2 }, { id: 'b', v: 1 }]);
    expect(r[0]).toEqual({ id: 'a', v: 2 });
    expect(r[1]).toBe(b);
  });
  it('sin cambios devuelve la misma referencia', () => {
    const prev = [a, b];
    expect(mergeById(prev, [{ id: 'b', v: 1 }])).toBe(prev);
  });
});

describe('windowFromDays', () => {
  it('rango de días con datos, con hoy siempre dentro', () => {
    expect(windowFromDays(['2026-10-27', '2026-10-30'], '2026-10-25')).toEqual({ from: '2026-10-25', to: '2026-10-30' });
    expect(windowFromDays(['2026-10-20'], '2026-10-25')).toEqual({ from: '2026-10-20', to: '2026-10-25' });
  });
  it('sin días → sin rango', () => {
    expect(windowFromDays([], '2026-10-25')).toEqual({ from: null, to: null });
  });
});

describe('nextDayWithMatches', () => {
  it('el primer día posterior con partidos', () => {
    expect(nextDayWithMatches(['2026-10-20', '2026-10-28', '2026-10-26'], '2026-10-25')).toBe('2026-10-26');
  });
  it('null si no hay', () => {
    expect(nextDayWithMatches(['2026-10-20'], '2026-10-25')).toBeNull();
  });
});
