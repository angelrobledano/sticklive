import { beforeEach, describe, expect, it, vi } from 'vitest';

import { consumePushInteraction, markPushInteraction } from './session-context.js';

const NOW = new Date('2026-10-07T12:00:00Z').getTime();

// AsyncStorage es código NATIVO: en vitest (node) se mockea con un Map
// (patrón del repo: adfree.test.ts).
const { storage } = vi.hoisted(() => ({ storage: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void storage.set(k, v)),
  },
}));

// La ventana de push vive en MEMORIA del módulo: los its de este describe se
// ejecutan en orden de declaración y comparten estado a propósito (el primero
// corre antes de ninguna marca; los siguientes re-marcan con su propio valor).
describe('consumePushInteraction (ventana de 60 s, la ruta del gol)', () => {
  it('sin interacción marcada ⇒ false', () => {
    expect(consumePushInteraction(NOW)).toBe(false);
  });

  it('interacción hace < 60 s ⇒ true', () => {
    markPushInteraction(NOW - 30_000);
    expect(consumePushInteraction(NOW)).toBe(true);
  });

  it('interacción hace ≥ 60 s ⇒ false', () => {
    markPushInteraction(NOW - 61_000);
    expect(consumePushInteraction(NOW)).toBe(false);
  });

  it('exactamente en el límite (60 s) ⇒ false', () => {
    markPushInteraction(NOW - 60_000);
    expect(consumePushInteraction(NOW)).toBe(false);
  });
});

// El contador de sesiones es 1×/arranque en frío por un flag de módulo: cada
// test recarga el módulo (vi.resetModules + import dinámico) para simular un
// arranque nuevo.
describe('contador de sesiones (ads.session_count en AsyncStorage)', () => {
  const loadFresh = async (): Promise<typeof import('./session-context.js')> => {
    vi.resetModules();
    return import('./session-context.js');
  };

  beforeEach(() => {
    storage.clear();
  });

  it('primer arranque ⇒ 1', async () => {
    const mod = await loadFresh();
    await mod.incrementSessionCountOnce();
    expect(await mod.readSessionCount()).toBe(1);
  });

  it('arranques previos incrementan (4 ⇒ 5)', async () => {
    storage.set('ads.session_count', '4');
    const mod = await loadFresh();
    await mod.incrementSessionCountOnce();
    expect(await mod.readSessionCount()).toBe(5);
  });

  it('contador basura ⇒ se cuenta desde cero (1)', async () => {
    storage.set('ads.session_count', 'no-soy-un-numero');
    const mod = await loadFresh();
    await mod.incrementSessionCountOnce();
    expect(await mod.readSessionCount()).toBe(1);
  });

  it('contador negativo ⇒ se cuenta desde cero (fail-closed: nueva sesión)', async () => {
    storage.set('ads.session_count', '-2');
    const mod = await loadFresh();
    await mod.incrementSessionCountOnce();
    expect(await mod.readSessionCount()).toBe(1);
  });

  it('UNA vez por arranque aunque se llame varias veces', async () => {
    const mod = await loadFresh();
    await mod.incrementSessionCountOnce();
    await mod.incrementSessionCountOnce();
    await mod.incrementSessionCountOnce();
    expect(await mod.readSessionCount()).toBe(1);
  });

  it('readSessionCount sin valor ⇒ 0 (fail-closed: cuenta como nueva sesión)', async () => {
    const mod = await loadFresh();
    expect(await mod.readSessionCount()).toBe(0);
  });
});
