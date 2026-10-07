import { beforeEach, describe, expect, it, vi } from 'vitest';

import { extendAdfree, getAdfreeUntil, grantAdfreeReward, isAdfreeActive, setAdfreeUntil } from './adfree.js';

const NOW = new Date('2026-10-07T12:00:00Z').getTime();
const MIN = 60_000;

// AsyncStorage es código NATIVO: en vitest (node) se mockea con un Map para
// poder probar el parseo defensivo del storage (patrón del repo: push.test.ts).
const { storage } = vi.hoisted(() => ({ storage: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void storage.set(k, v)),
  },
}));

describe('isAdfreeActive', () => {
  it('activo si adfree_until está en el futuro', () => {
    expect(isAdfreeActive(NOW, NOW + MIN)).toBe(true);
    expect(isAdfreeActive(NOW, NOW)).toBe(false);
    expect(isAdfreeActive(NOW, null)).toBe(false);
  });

  it('timestamp basura (NaN, Infinity) ⇒ sin adfree (fail-closed, regla de dinero)', () => {
    expect(isAdfreeActive(NOW, Number.NaN)).toBe(false);
    expect(isAdfreeActive(NOW, Number.POSITIVE_INFINITY)).toBe(false);
    expect(isAdfreeActive(NOW, undefined)).toBe(false);
  });
});

describe('extendAdfree (30 min desde la caducidad actual, no desde ahora)', () => {
  it('sin adfree previo: ahora + 30 min', () => {
    expect(extendAdfree(NOW, null, 30)).toBe(NOW + 30 * MIN);
  });
  it('con adfree vigente: extiende DESDE la caducidad (acumulable)', () => {
    expect(extendAdfree(NOW, NOW + 10 * MIN, 30)).toBe(NOW + 40 * MIN);
  });
  it('con adfree caducado: desde ahora', () => {
    expect(extendAdfree(NOW, NOW - 5 * MIN, 30)).toBe(NOW + 30 * MIN);
  });
});

describe('grantAdfreeReward (contrato del reward: adfree_min × adfreeMinutes)', () => {
  it('match ⇒ concede (extendAdfree desde la caducidad)', () => {
    expect(grantAdfreeReward({ type: 'adfree_min', amount: 30 }, 30, null, NOW)).toBe(
      NOW + 30 * MIN,
    );
    expect(
      grantAdfreeReward({ type: 'adfree_min', amount: 30 }, 30, NOW + 10 * MIN, NOW),
    ).toBe(NOW + 40 * MIN);
  });

  it('mismatch de type o amount ⇒ null (no se concede, regla de dinero)', () => {
    expect(grantAdfreeReward({ type: 'coins', amount: 30 }, 30, null, NOW)).toBeNull();
    expect(grantAdfreeReward({ type: 'adfree_min', amount: 50 }, 30, null, NOW)).toBeNull();
    expect(grantAdfreeReward({ type: 'adfree_min', amount: 30 }, 60, null, NOW)).toBeNull();
  });

  it('reward null/undefined ⇒ null', () => {
    expect(grantAdfreeReward(null, 30, null, NOW)).toBeNull();
    expect(grantAdfreeReward(undefined, 30, null, NOW)).toBeNull();
  });
});

describe('storage (ads.adfree_until en AsyncStorage)', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('sin valor previo ⇒ null', async () => {
    expect(await getAdfreeUntil()).toBeNull();
  });

  it('guarda y recupera el timestamp', async () => {
    await setAdfreeUntil(NOW + MIN);
    expect(await getAdfreeUntil()).toBe(NOW + MIN);
  });

  it('valor basura persistido ⇒ null (malos datos son peores que no tener datos)', async () => {
    storage.set('ads.adfree_until', 'no-soy-un-numero');
    expect(await getAdfreeUntil()).toBeNull();
    storage.set('ads.adfree_until', 'NaN');
    expect(await getAdfreeUntil()).toBeNull();
    storage.set('ads.adfree_until', 'Infinity');
    expect(await getAdfreeUntil()).toBeNull();
  });
});
