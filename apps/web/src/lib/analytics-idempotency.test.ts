import { describe, it, expect } from 'vitest';
import { claimOnce } from './analytics';

/**
 * #247: los eventos de compra (`premium_purchase_completed` en /premium/success
 * y `premium_purchase_failed`) se emitían en CADA montaje/recarga de la página.
 * `claimOnce` es el guard puro: true la primera vez que se ve la clave en un
 * almacén, false después. En los componentes se usa con `sessionStorage` y una
 * clave derivada del `session_id`/order de la operación.
 */

function makeStore(failOnWrite = false) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failOnWrite) throw new Error('quota');
      data.set(k, v);
    },
  };
}

describe('claimOnce (#247 idempotencia)', () => {
  it('devuelve true la primera vez y false en los montajes/recargas posteriores', () => {
    const store = makeStore();
    expect(claimOnce(store, 'premium-completed:cs_1')).toBe(true);
    expect(claimOnce(store, 'premium-completed:cs_1')).toBe(false);
    expect(claimOnce(store, 'premium-completed:cs_1')).toBe(false);
    expect(store.data.get('premium-completed:cs_1')).toBe('1');
  });

  it('claves distintas son independientes', () => {
    const store = makeStore();
    expect(claimOnce(store, 'premium-completed:cs_1')).toBe(true);
    expect(claimOnce(store, 'premium-completed:cs_2')).toBe(true);
    expect(claimOnce(store, 'premium-failed:order_1')).toBe(true);
  });

  it('si el almacén no está disponible no deduplica (mejor contar que perder)', () => {
    const store = makeStore(true);
    expect(claimOnce(store, 'premium-completed:cs_1')).toBe(true);
    expect(claimOnce(store, 'premium-completed:cs_1')).toBe(true);
  });
});
