import { describe, expect, it } from 'vitest';
import { formatDayKey, formatDayLabel, formatKickoff, isEffectivelyLive } from './time';
import { STALE_LIVE_HOURS } from '@sports/shared-types';

describe('time', () => {
  it('formatKickoff pinta HH:MM en Europe/Madrid', () => {
    // 17:00 UTC de un día de verano = 19:00 Madrid (CEST)
    const iso = '2026-10-03T17:00:00.000Z';
    expect(formatKickoff(iso)).toMatch(/^19:00$/);
  });

  it('isEffectivelyLive: scheduled reciente (dentro de la ventana stale) = live por reloj', () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // hace 1 h
    expect(isEffectivelyLive('scheduled', recent)).toBe(true);
  });

  it('isEffectivelyLive: scheduled fuera de la ventana stale = no live', () => {
    const old = new Date(Date.now() - (STALE_LIVE_HOURS + 1) * 60 * 60 * 1000).toISOString();
    expect(isEffectivelyLive('scheduled', old)).toBe(false);
  });

  it('isEffectivelyLive: finished nunca es live', () => {
    expect(isEffectivelyLive('finished', new Date().toISOString())).toBe(false);
  });

  it('guard de NaN: fecha inválida → "--:--" / ""', () => {
    expect(formatKickoff('no-fecha')).toBe('--:--');
    expect(formatDayLabel('no-fecha')).toBe('');
  });

  // Task 5.2: clave de sección de la home por fecha ISO (estable, sin
  // colisiones con '__live__' ni entre etiquetas localizadas).
  it('formatDayKey pinta YYYY-MM-DD en Europe/Madrid', () => {
    // 17:00 UTC de un día de verano = 19:00 Madrid → mismo día
    expect(formatDayKey('2026-10-03T17:00:00.000Z')).toBe('2026-10-03');
  });

  it('formatDayKey cruza el día según Madrid (22:30 UTC de octubre = 00:30 del día siguiente)', () => {
    expect(formatDayKey('2026-10-03T22:30:00.000Z')).toBe('2026-10-04');
  });

  it('formatDayKey: sin fecha o inválida → ""', () => {
    expect(formatDayKey(null)).toBe('');
    expect(formatDayKey('no-fecha')).toBe('');
  });
});
