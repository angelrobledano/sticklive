import { describe, it, expect } from 'vitest';
import { refreshDue, madridHour } from './refresh-cadence.js';

// Noviembre: Madrid = UTC+1.
const at = (hMadrid: number) => new Date(Date.UTC(2026, 10, 2, (hMadrid + 23) % 24, 5));

describe('ritmo del calendario sidgad', () => {
  it('hora de Madrid', () => { expect(madridHour(at(13))).toBe(13); });
  it('con partidos cerca: cada hora, salvo de madrugada', () => {
    expect(refreshDue(true, at(13), false)).toBe(true);
    expect(refreshDue(true, at(23), false)).toBe(true);
    expect(refreshDue(true, at(3), false)).toBe(false);
  });
  it('en reposo: solo a las 0, 6, 12 y 18', () => {
    expect([0, 6, 12, 18].map((h) => refreshDue(false, at(h), false))).toEqual([true, true, true, true]);
    expect([7, 13, 20].map((h) => refreshDue(false, at(h), false))).toEqual([false, false, false]);
  });
  it('REFRESH_ALWAYS: todo, siempre', () => {
    expect(refreshDue(false, at(3), true)).toBe(true);
  });
});
