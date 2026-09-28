import { describe, it, expect } from 'vitest';
import { freshnessState, FRESH_MAX_MS, STALE_MAX_MS } from './timeline-model';

/**
 * Indicador de frescura del directo (#284). Función pura: decide si el marcador
 * está fresco, en posible desfase o sin señal, a partir del instante de la
 * última actualización. Sin navegador.
 */
describe('freshnessState', () => {
  const now = 1_000_000_000_000;

  it('recién actualizado → fresh con el texto de segundos', () => {
    const f = freshnessState(now - 3_000, now);
    expect(f.state).toBe('fresh');
    expect(f.ageSeconds).toBe(3);
    expect(f.labelKey).toBe('match_detail.freshness_fresh');
  });

  it('justo en el límite de fresh (< FRESH_MAX_MS)', () => {
    expect(freshnessState(now - (FRESH_MAX_MS - 1), now).state).toBe('fresh');
    expect(freshnessState(now - FRESH_MAX_MS, now).state).toBe('stale');
  });

  it('sin actualizaciones recientes → stale (posible desfase)', () => {
    const f = freshnessState(now - 60_000, now);
    expect(f.state).toBe('stale');
    expect(f.ageSeconds).toBe(60);
    expect(f.labelKey).toBe('match_detail.freshness_stale');
  });

  it('pasado el umbral alto → down (sin señal)', () => {
    const f = freshnessState(now - (STALE_MAX_MS + 1), now);
    expect(f.state).toBe('down');
    expect(f.labelKey).toBe('match_detail.freshness_down');
  });

  it('sin ninguna actualización (null) → down', () => {
    expect(freshnessState(null, now).state).toBe('down');
  });

  it('relojes desincronizados (last en el futuro) → age 0 y fresh', () => {
    const f = freshnessState(now + 5_000, now);
    expect(f.ageSeconds).toBe(0);
    expect(f.state).toBe('fresh');
  });

  it('el aviso del servidor (poll fallido) degrada fresh → stale', () => {
    const f = freshnessState(now - 1_000, now, true);
    expect(f.state).toBe('stale');
    expect(f.labelKey).toBe('match_detail.freshness_stale');
  });

  it('el aviso del servidor no "mejora" un down a stale', () => {
    expect(freshnessState(now - (STALE_MAX_MS + 1), now, true).state).toBe('down');
  });
});
