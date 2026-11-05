import { describe, expect, it } from 'vitest';
import { formatDayLabel, formatDayShort, formatKickoff, isAdQuietTime, isEffectivelyLive } from './time';
import { STALE_LIVE_HOURS } from '@sports/shared-types';

describe('time', () => {
  it('formatKickoff pinta HH:MM en Europe/Madrid', () => {
    // 17:00 UTC de un día de verano = 19:00 Madrid (CEST)
    const iso = '2026-10-03T17:00:00.000Z';
    expect(formatKickoff(iso)).toMatch(/^19:00$/);
  });

  it('isEffectivelyLive: un scheduled con el saque pasado NO es live (la hora no fabrica directos)', () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // hace 1 h
    expect(isEffectivelyLive('scheduled', recent)).toBe(false);
    const old = new Date(Date.now() - (STALE_LIVE_HOURS + 1) * 60 * 60 * 1000).toISOString();
    expect(isEffectivelyLive('scheduled', old)).toBe(false);
  });

  it('isEffectivelyLive: el estado en juego de la fuente es live, sea cual sea la hora', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(isEffectivelyLive('live', future)).toBe(true);
    expect(isEffectivelyLive('halftime', null)).toBe(true);
  });

  it('isAdQuietTime: sin anuncios en juego y en la ventana de inicio (pendiente), sí antes y tras el dato muerto', () => {
    const now = Date.parse('2026-10-03T18:00:00.000Z');
    const at = (h: number) => new Date(now + h * 3_600_000).toISOString();
    expect(isAdQuietTime('live', at(2), now)).toBe(true);
    expect(isAdQuietTime('scheduled', at(-1), now)).toBe(true);   // la hora ya llegó: puede estar empezando
    expect(isAdQuietTime('scheduled', at(1), now)).toBe(false);   // aún no es la hora
    expect(isAdQuietTime('scheduled', at(-6), now)).toBe(false);  // dato muerto
    expect(isAdQuietTime('finished', at(-1), now)).toBe(false);
  });

  it('isEffectivelyLive: finished nunca es live', () => {
    expect(isEffectivelyLive('finished', new Date().toISOString())).toBe(false);
  });

  it('guard de NaN: fecha inválida → "--:--" / ""', () => {
    expect(formatKickoff('no-fecha')).toBe('--:--');
    expect(formatDayLabel('no-fecha')).toBe('');
  });

  it('formatDayLabel soporta locale (ca: divendres, es: viernes)', () => {
    const iso = '2026-10-23T18:00:00.000Z';
    expect(formatDayLabel(iso, 'es').toLowerCase()).toContain('viernes');
    expect(formatDayLabel(iso, 'ca').toLowerCase()).toContain('divendres');
  });

  it('formatDayShort pinta día abreviado y número para no truncar en móviles', () => {
    const iso = '2026-10-23T18:00:00.000Z';
    expect(formatDayShort(iso, 'es').toLowerCase()).toMatch(/vie|s[aá]b/);
    expect(formatDayShort('no-fecha')).toBe('');
  });

});
