import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canShowFullScreen,
  getFullScreenBudget,
  registerFullScreenShow,
  setFullScreenBudget,
} from './fullscreen.js';

const NOW = new Date('2026-10-07T12:00:00Z').getTime();
const MIN = 60_000;

const base = {
  enabled: true,
  now: NOW,
  lastShownAt: null as number | null,
  hourBucket: '2026-10-07T12' as string,
  showsThisHour: 0,
  sessionCount: 5, // grace: < 2 sesiones bloquea
  fromPush: false,
};

describe('canShowFullScreen (presupuesto compartido app open + interstitial)', () => {
  it('verde con todo limpio', () => {
    expect(canShowFullScreen(base)).toBe(true);
  });

  it('bloquea: dentro de las 2 primeras sesiones (grace, doc de Google)', () => {
    expect(canShowFullScreen({ ...base, sessionCount: 1 })).toBe(false);
    expect(canShowFullScreen({ ...base, sessionCount: 2 })).toBe(false);
    expect(canShowFullScreen({ ...base, sessionCount: 3 })).toBe(true);
  });

  it('bloquea: sessionCount no entero cuenta como sesión nueva (fail-closed)', () => {
    expect(canShowFullScreen({ ...base, sessionCount: Number.NaN })).toBe(false);
    expect(canShowFullScreen({ ...base, sessionCount: 2.5 })).toBe(false);
  });

  it('bloquea: vino de push (ruta del gol)', () => {
    expect(canShowFullScreen({ ...base, fromPush: true })).toBe(false);
  });

  it('bloquea: mínimo 20 min desde el último show', () => {
    expect(canShowFullScreen({ ...base, lastShownAt: NOW - 19 * MIN })).toBe(false);
    expect(canShowFullScreen({ ...base, lastShownAt: NOW - 21 * MIN })).toBe(true);
  });

  it('bloquea: 2 shows ya en esta hora', () => {
    expect(canShowFullScreen({ ...base, showsThisHour: 2 })).toBe(false);
    expect(canShowFullScreen({ ...base, showsThisHour: 1 })).toBe(true);
  });

  it('cambia la hora ⇒ contador a cero (reset por bucket)', () => {
    expect(canShowFullScreen({ ...base, showsThisHour: 2, hourBucket: '2026-10-07T13' })).toBe(true);
  });

  it('formato desactivado ⇒ false', () => {
    expect(canShowFullScreen({ ...base, enabled: false })).toBe(false);
  });
});

describe('registerFullScreenShow', () => {
  it('devuelve lastShownAt=now y showsThisHour+1 (mismo bucket)', () => {
    const st = registerFullScreenShow(base, NOW);
    expect(st).toEqual({ lastShownAt: NOW, showsThisHour: 1, hourBucket: '2026-10-07T12' });
  });

  it('cambió la hora ⇒ contador reinicia en 1 (no acumula del bucket anterior)', () => {
    const st = registerFullScreenShow({ ...base, showsThisHour: 2, hourBucket: '2026-10-07T11' }, NOW);
    expect(st).toEqual({ lastShownAt: NOW, showsThisHour: 1, hourBucket: '2026-10-07T12' });
  });
});

describe('storage (ads.fullscreen_state en AsyncStorage)', () => {
  // AsyncStorage es código NATIVO: en vitest (node) se mockea con un Map
  // (patrón del repo: adfree.test.ts).
  const { storage } = vi.hoisted(() => ({ storage: new Map<string, string>() }));
  vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
      getItem: vi.fn(async (k: string) => storage.get(k) ?? null),
      setItem: vi.fn(async (k: string, v: string) => void storage.set(k, v)),
    },
  }));

  beforeEach(() => {
    storage.clear();
  });

  it('sin valor previo ⇒ presupuesto fresco', async () => {
    expect(await getFullScreenBudget()).toEqual({
      lastShownAt: null,
      showsThisHour: 0,
      hourBucket: '',
    });
  });

  it('guarda y recupera el estado', async () => {
    await setFullScreenBudget({ lastShownAt: NOW, showsThisHour: 2, hourBucket: '2026-10-07T12' });
    expect(await getFullScreenBudget()).toEqual({
      lastShownAt: NOW,
      showsThisHour: 2,
      hourBucket: '2026-10-07T12',
    });
  });

  it('storage basura ⇒ defaults (malos datos son peores que no tener datos)', async () => {
    const FRESH = { lastShownAt: null, showsThisHour: 0, hourBucket: '' };
    storage.set('ads.fullscreen_state', 'no-soy-json');
    expect(await getFullScreenBudget()).toEqual(FRESH);
    storage.set('ads.fullscreen_state', 'null');
    expect(await getFullScreenBudget()).toEqual(FRESH);
    storage.set('ads.fullscreen_state', '123');
    expect(await getFullScreenBudget()).toEqual(FRESH);
    storage.set('ads.fullscreen_state', '"texto"');
    expect(await getFullScreenBudget()).toEqual(FRESH);
    storage.set('ads.fullscreen_state', '{"lastShownAt":"x","showsThisHour":-3,"hourBucket":5}');
    expect(await getFullScreenBudget()).toEqual(FRESH);
    storage.set('ads.fullscreen_state', '{"lastShownAt":123,"showsThisHour":2.5,"hourBucket":"b"}');
    // Campo a campo: solo los valores válidos sobreviven.
    expect(await getFullScreenBudget()).toEqual({ lastShownAt: 123, showsThisHour: 0, hourBucket: 'b' });
  });
});
