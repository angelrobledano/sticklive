import { describe, it, expect } from 'vitest';
import { formatTime } from '@/components/shared/MatchCard';

// La lógica pura (isTimeTbd, timeTbdLabel) se prueba en packages/core/src/match-time.test.ts.
describe('hora por confirmar en el listado', () => {
  it('el listado pinta «Por confirmar» en vez de 00:00', () => {
    expect(formatTime('2026-11-06T23:00:00Z', 'Europe/Madrid', 'es')).toBe('Por confirmar');
  });
});
