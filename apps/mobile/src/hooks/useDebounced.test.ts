import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_DEBOUNCE_MS, scheduleDebounce } from './useDebounced';

/**
 * Test de CONTRATO del debounce con extracción pura (misma técnica sancionada
 * en Task 2.2): NO se renderiza el hook. `@testing-library/react-native` está
 * descartado en este repo (frágil bajo vitest+node con React 19 en Windows,
 * ver queries.test.ts) y no hay ningún otro renderer disponible (no se añade
 * react-test-renderer/react-dom sólo para esto: dependencia no declarada y
 * obsoleta en React 19).
 *
 * Por eso la lógica del debounce vive en `scheduleDebounce` (función PURA con
 * timers inyectables) y `useDebounced` se limita al wiring estándar
 * useState + useEffect(cleanup) — ese cableado se verifica por build/export y
 * por la verificación manual de la pantalla de búsqueda (Task 2.5 Step 8).
 *
 * Semántica que se verifica aquí (la que exige la pantalla de búsqueda):
 * con rerenders rápidos sólo el ÚLTIMO valor se emite, y tras el delay
 * completo — los timers anteriores se cancelan (el cleanup del useEffect).
 */

afterEach(() => {
  vi.useRealTimers();
});

describe('scheduleDebounce (núcleo puro de useDebounced)', () => {
  it('SEARCH_DEBOUNCE_MS es el delay de contrato de la búsqueda (300 ms)', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(300);
  });

  it('sólo emite el último valor, y tras el delay completo', () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const emit = (v: string) => emitted.push(v);

    // "Rerenders" rápidos: cada valor nuevo CANCELA el timer del anterior
    // (simula el cleanup del useEffect del hook) y reprograma el suyo.
    scheduleDebounce('a', SEARCH_DEBOUNCE_MS, emit)();
    scheduleDebounce('ab', SEARCH_DEBOUNCE_MS, emit)();
    const cancel = scheduleDebounce('abc', SEARCH_DEBOUNCE_MS, emit);

    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(emitted).toEqual([]); // nada antes del delay completo

    vi.advanceTimersByTime(1);
    expect(emitted).toEqual(['abc']); // sólo el último, exactamente al vencer

    // El cancel devuelto es el cleanup del useEffect: evita la emisión.
    cancel();
    vi.advanceTimersByTime(10_000);
    expect(emitted).toEqual(['abc']);
  });

  it('cada programa emite su valor propio; sin cancels no se pierde ninguno', () => {
    vi.useFakeTimers();
    const emitted: string[] = [];

    scheduleDebounce('x', 100, (v) => emitted.push(v));
    vi.advanceTimersByTime(50);
    scheduleDebounce('y', 100, (v) => emitted.push(v)); // sin cancelar el de 'x'
    vi.advanceTimersByTime(60);
    expect(emitted).toEqual(['x']); // 'x' vence a los 100 ms
    vi.advanceTimersByTime(50);
    expect(emitted).toEqual(['x', 'y']); // 'y' vence a los 150 ms
  });
});
