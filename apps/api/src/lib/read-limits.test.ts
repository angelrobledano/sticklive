import { describe, it, expect } from 'vitest';
import { READ_LIMIT_MAX, READ_LIMIT_WINDOW_MS, READ_LIMIT_PATHS } from './read-limits.js';

/**
 * #333: /matches/live y /matches/current se registraban dos veces (explícito +
 * /matches/:id). En Hono ambos middleware casan la misma ruta y el tope real
 * era 60/min en vez de los 120 documentados.
 */
describe('READ_LIMIT_PATHS', () => {
  it('el tope documentado es 120/min', () => {
    expect(READ_LIMIT_MAX).toBe(120);
    expect(READ_LIMIT_WINDOW_MS).toBe(60_000);
  });

  it('/matches/:id cubre live y current (una sola vez)', () => {
    expect(READ_LIMIT_PATHS).toContain('/matches/:id');
    // Registrarlos aparte duplicaría el middleware (bug #333).
    expect(READ_LIMIT_PATHS).not.toContain('/matches/live');
    expect(READ_LIMIT_PATHS).not.toContain('/matches/current');
  });

  it('no hay rutas repetidas en la lista', () => {
    expect(new Set(READ_LIMIT_PATHS).size).toBe(READ_LIMIT_PATHS.length);
  });
});
