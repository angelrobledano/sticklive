import { describe, it, expect } from 'vitest';
import { isTimeTbd, timeTbdLabel } from './match-time';
import { formatTime } from '@/components/shared/MatchCard';

describe('hora por confirmar', () => {
  it('medianoche en Madrid o en Lisboa = sin hora; una hora real, no', () => {
    expect(isTimeTbd('2026-11-06T23:00:00Z')).toBe(true); // 00:00 Madrid (invierno)
    expect(isTimeTbd('2026-11-07T00:00:00Z')).toBe(true); // 00:00 Lisboa
    expect(isTimeTbd('2026-11-07T17:00:00Z')).toBe(false);
    expect(isTimeTbd(null)).toBe(false);
  });

  it('con la zona de la sede solo cuenta su medianoche', () => {
    expect(isTimeTbd('2026-11-07T00:00:00Z', 'Europe/Madrid')).toBe(false);
  });

  it('el listado pinta «Por confirmar» en vez de 00:00', () => {
    expect(formatTime('2026-11-06T23:00:00Z', 'Europe/Madrid', 'es')).toBe('Por confirmar');
    expect(timeTbdLabel('pt')).toBe('A confirmar');
  });
});
