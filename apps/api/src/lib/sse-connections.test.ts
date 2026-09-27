import { describe, it, expect } from 'vitest';
import { ConnectionLimiter } from './sse-connections.js';

describe('ConnectionLimiter', () => {
  it('admite conexiones hasta el tope por IP y luego las rechaza por IP', () => {
    const limiter = new ConnectionLimiter(1000, 2);
    expect(limiter.tryAcquire('1.1.1.1').ok).toBe(true);
    expect(limiter.tryAcquire('1.1.1.1').ok).toBe(true);

    const third = limiter.tryAcquire('1.1.1.1');
    expect(third.ok).toBe(false);
    expect(third.reason).toBe('per_ip');
    // Otra IP no se ve afectada por el cupo agotado de la primera.
    expect(limiter.tryAcquire('2.2.2.2').ok).toBe(true);
  });

  it('respeta el tope global por encima del tope por IP', () => {
    const limiter = new ConnectionLimiter(2, 1000);
    expect(limiter.tryAcquire('a').ok).toBe(true);
    expect(limiter.tryAcquire('b').ok).toBe(true);

    const third = limiter.tryAcquire('c');
    expect(third.ok).toBe(false);
    expect(third.reason).toBe('global');
  });

  it('al liberar se recupera cupo por IP y global sin desbordar', () => {
    const limiter = new ConnectionLimiter(1, 1);
    expect(limiter.tryAcquire('ip').ok).toBe(true);
    expect(limiter.tryAcquire('ip').ok).toBe(false);

    limiter.release('ip');
    expect(limiter.totalCount()).toBe(0);
    expect(limiter.countFor('ip')).toBe(0);
    expect(limiter.tryAcquire('ip').ok).toBe(true);

    // Liberar de más no deja contadores negativos.
    limiter.release('ip');
    limiter.release('ip');
    expect(limiter.totalCount()).toBe(0);
    expect(limiter.countFor('ip')).toBe(0);
  });
});
