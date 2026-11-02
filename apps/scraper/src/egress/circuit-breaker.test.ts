import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('cerrado deja pasar y acumula fallos hasta el umbral', () => {
    const breaker = new CircuitBreaker(3, 60_000, () => 0);
    expect(breaker.allow()).toBe(true);
    expect(breaker.recordFailure()).toBe(false);
    expect(breaker.recordFailure()).toBe(false);
    expect(breaker.allow()).toBe(true);
    expect(breaker.recordFailure()).toBe(true); // acaba de abrirse
    expect(breaker.state()).toBe('open');
    expect(breaker.allow()).toBe(false);
  });

  it('tras el enfriamiento deja UNA prueba half-open', () => {
    let now = 0;
    const breaker = new CircuitBreaker(1, 1000, () => now);
    breaker.recordFailure();
    expect(breaker.allow()).toBe(false);

    now = 1000;
    expect(breaker.state()).toBe('half-open');
    expect(breaker.allow()).toBe(true);
    expect(breaker.allow()).toBe(false); // ya hay una prueba en vuelo
  });

  it('un éxito en half-open cierra el circuito y reporta recuperación', () => {
    let now = 0;
    const breaker = new CircuitBreaker(1, 1000, () => now);
    breaker.recordFailure();
    now = 1000;
    expect(breaker.allow()).toBe(true);
    expect(breaker.recordSuccess()).toBe(true);
    expect(breaker.state()).toBe('closed');
    expect(breaker.allow()).toBe(true);
  });

  it('un fallo en half-open reabre con enfriamiento nuevo', () => {
    let now = 0;
    const breaker = new CircuitBreaker(1, 1000, () => now);
    breaker.recordFailure();
    now = 1000;
    expect(breaker.allow()).toBe(true);
    expect(breaker.recordFailure()).toBe(false);
    expect(breaker.state()).toBe('open');
    now = 1500;
    expect(breaker.allow()).toBe(false);
    now = 2000;
    expect(breaker.allow()).toBe(true);
  });

  it('snapshot informa estado, fallos y enfriamiento restante', () => {
    let now = 10_000;
    const breaker = new CircuitBreaker(2, 5000, () => now);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.snapshot()).toMatchObject({
      state: 'open',
      failures: 2,
      openedAt: 10_000,
      cooldownRemainingMs: 5000,
    });
    now = 13_000;
    expect(breaker.snapshot().cooldownRemainingMs).toBe(2000);
  });

  it('reset vuelve a cerrado', () => {
    const breaker = new CircuitBreaker(1, 1000, () => 0);
    breaker.recordFailure();
    breaker.reset();
    expect(breaker.state()).toBe('closed');
    expect(breaker.allow()).toBe(true);
  });

  it('valida sus parámetros', () => {
    expect(() => new CircuitBreaker(0, 1000)).toThrow(/threshold/);
    expect(() => new CircuitBreaker(1, -1)).toThrow(/cooldown/);
  });
});
