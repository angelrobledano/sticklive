import { describe, expect, it } from 'vitest';
import { hasWatchLink, rowCenter } from './match-row';

const NOW = Date.parse('2026-11-05T18:00:00Z');
const base = { status: 'scheduled', scheduledAt: '2026-11-05T20:00:00Z', startedAt: null, score: { home: null, away: null } };

describe('rowCenter (paridad con la fila de la web)', () => {
  it('directo y descanso', () => {
    expect(rowCenter({ ...base, status: 'live' }, NOW)).toEqual({ kind: 'live', halftime: false });
    expect(rowCenter({ ...base, status: 'live', isHalftime: true }, NOW)).toEqual({ kind: 'live', halftime: true });
    expect(rowCenter({ ...base, status: 'halftime' }, NOW)).toEqual({ kind: 'live', halftime: true });
  });

  it('final con prórroga y con penaltis', () => {
    expect(rowCenter({ ...base, status: 'finished', winType: 'overtime' }, NOW))
      .toEqual({ kind: 'finished', finalKey: 'match_states.final_overtime', penalties: null });
    expect(rowCenter({ ...base, status: 'finished', winType: 'penalties', penalties: { home: 3, away: 2 } }, NOW))
      .toEqual({ kind: 'finished', finalKey: 'match_states.final_penalties', penalties: '3 - 2' });
  });

  it('aplazado y cancelado', () => {
    expect(rowCenter({ ...base, status: 'postponed' }, NOW)).toEqual({ kind: 'postponed' });
    expect(rowCenter({ ...base, status: 'cancelled' }, NOW)).toEqual({ kind: 'cancelled' });
  });

  it('programado: futuro, pendiente de empezar y sin resultado', () => {
    expect(rowCenter(base, NOW)).toEqual({ kind: 'scheduled', hint: null, tbd: false });
    expect(rowCenter({ ...base, scheduledAt: '2026-11-05T17:30:00Z' }, NOW))
      .toEqual({ kind: 'scheduled', hint: 'match_states.awaiting_start', tbd: false });
    expect(rowCenter({ ...base, scheduledAt: '2026-11-01T17:30:00Z' }, NOW))
      .toEqual({ kind: 'scheduled', hint: 'match_states.no_result', tbd: false });
  });

  it('hora por confirmar (medianoche de Madrid)', () => {
    expect(rowCenter({ ...base, scheduledAt: '2026-11-06T23:00:00Z' }, NOW)).toMatchObject({ tbd: true });
  });
});

describe('hasWatchLink', () => {
  it('solo con enlace y sin aplazar ni cancelar', () => {
    expect(hasWatchLink({ status: 'live', videoUrl: 'https://okliga.tv/x' })).toBe(true);
    expect(hasWatchLink({ status: 'postponed', videoUrl: 'https://okliga.tv/x' })).toBe(false);
    expect(hasWatchLink({ status: 'finished', videoUrl: null })).toBe(false);
  });
});
