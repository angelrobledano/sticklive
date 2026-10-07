import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canShowFullScreen,
  getFullScreenBudget,
  registerFullScreenShow,
  runFullScreenShowAttempt,
  setFullScreenBudget,
} from './fullscreen.js';

const NOW = new Date('2026-10-07T12:00:00Z').getTime();
const MIN = 60_000;

// AsyncStorage es código NATIVO: en vitest (node) se mockea con un Map
// (patrón del repo: adfree.test.ts). A nivel de módulo: lo comparten los tests
// de storage y los de la cola serializada del presupuesto.
const { storage } = vi.hoisted(() => ({ storage: new Map<string, string>() }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => storage.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void storage.set(k, v)),
  },
}));

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

describe('runFullScreenShowAttempt (cola serializada del presupuesto compartido)', () => {
  // Dos escritores (app open Task 4 + interstitial Task 5): sin la cola, dos
  // intentos solapados leen el mismo storage, ven el cap verde ambos y rompen
  // el máximo de shows/hora y el mínimo entre shows.
  beforeEach(() => {
    storage.clear();
  });

  it('el segundo intento ve el show que registró el primero (no hay lost update)', async () => {
    storage.set(
      'ads.fullscreen_state',
      JSON.stringify({ lastShownAt: NOW - 30 * MIN, showsThisHour: 1, hourBucket: '2026-10-07T12' }),
    );
    const order: string[] = [];
    const p1 = runFullScreenShowAttempt(async (budget) => {
      order.push('p1');
      // Verde (1 show, hace 30 min): se muestra y se registra.
      expect(canShowFullScreen({ ...base, ...budget })).toBe(true);
      return registerFullScreenShow(budget, NOW);
    });
    const p2 = runFullScreenShowAttempt(async (budget) => {
      order.push('p2');
      // Lanza DESPUÉS de p1: lee el storage que p1 ya persistió (2 shows esta
      // hora) y el presupuesto sale rojo.
      return canShowFullScreen({ ...base, ...budget }) ? registerFullScreenShow(budget, NOW) : null;
    });
    const [shown1, shown2] = await Promise.all([p1, p2]);
    expect(order).toEqual(['p1', 'p2']); // estrictamente en serie
    expect(shown1).toBe(true);
    expect(shown2).toBe(false);
    expect(await getFullScreenBudget()).toEqual({
      lastShownAt: NOW,
      showsThisHour: 2,
      hourBucket: '2026-10-07T12',
    });
  });

  it('intento sin show (null) ⇒ no persiste nada', async () => {
    const shown = await runFullScreenShowAttempt(async () => null);
    expect(shown).toBe(false);
    expect(storage.has('ads.fullscreen_state')).toBe(false);
  });

  it('un intento que lanza no rompe la cola: el rechazo llega al llamador y el siguiente corre', async () => {
    const p1 = runFullScreenShowAttempt(async () => {
      throw new Error('boom');
    });
    const p2 = runFullScreenShowAttempt(async (budget) => registerFullScreenShow(budget, NOW));
    await expect(p1).rejects.toThrow('boom');
    expect(await p2).toBe(true);
    expect(await getFullScreenBudget()).toEqual({
      lastShownAt: NOW,
      showsThisHour: 1,
      hourBucket: '2026-10-07T12',
    });
  });
});
