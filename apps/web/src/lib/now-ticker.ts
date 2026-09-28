'use client';

/**
 * Reloj compartido de 30 s (#366).
 *
 * Antes, cada MatchCard en estado "scheduled" montaba su propio `setInterval`
 * (~20-30 timers por jornada). Ahora todos comparten una única suscripción que
 * se apaga sola cuando no queda ningún suscriptor.
 */
import { useSyncExternalStore } from 'react';

let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => now;
// En SSR/hidratación devolvemos 0 (partido no "pasado"), para que servidor y
// cliente coincidan; el valor real llega en el primer tick tras montar.
const getServerSnapshot = () => 0;

/** Hora "actual" que se refresca cada 30 s (suscripción única compartida). */
export function useNow30s(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
