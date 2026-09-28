import { describe, it, expect } from 'vitest';
import { createMemoryNonceStore } from './oauth-nonce.js';

describe('createMemoryNonceStore (#306) — single-use del state OAuth', () => {
  it('acepta el primer uso de un nonce y rechaza la reutilización', async () => {
    const store = createMemoryNonceStore(() => 1_000_000);
    const exp = new Date(2_000_000);
    expect(await store.consume('nonce-1', exp)).toBe(true);
    expect(await store.consume('nonce-1', exp)).toBe(false);
  });

  it('nonces distintos son independientes', async () => {
    const store = createMemoryNonceStore(() => 1_000_000);
    const exp = new Date(2_000_000);
    expect(await store.consume('a', exp)).toBe(true);
    expect(await store.consume('b', exp)).toBe(true);
  });

  it('purga los nonces caducados para no crecer sin límite', async () => {
    let now = 1_000_000;
    const store = createMemoryNonceStore(() => now);
    // Caduca pronto; el TTL del state lo garantiza, pero forzamos la purga.
    expect(await store.consume('viejo', new Date(now + 10))).toBe(true);
    now = 1_000_100; // ya caducó
    // Al consumir otro, se limpia el caducado; un nonce expirado no bloquea.
    expect(await store.consume('nuevo', new Date(now + 10_000))).toBe(true);
  });
});
