import { useEffect, useState } from 'react';

/**
 * Delay de contrato de la búsqueda móvil (300 ms, como la web): exportado para
 * testearlo y para que la pantalla lo use en vez de un literal suelto.
 */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Núcleo PURO del debounce (extraída para poder testearla sin renderizar:
 * ver useDebounced.test.ts). Programa `emit(value)` tras `delayMs` y devuelve
 * la cancelación — el hook la usa como cleanup del useEffect, de modo que un
 * cambio de valor rápido ("rerender") anula el timer pendiente y gana el
 * último ("latest-wins").
 */
export function scheduleDebounce<T>(
  value: T,
  delayMs: number,
  emit: (value: T) => void,
  timers: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis,
): () => void {
  const id = timers.setTimeout(() => emit(value), delayMs);
  return () => timers.clearTimeout(id);
}

/**
 * Valor con debounce estándar: mientras `value` cambie antes de `delayMs`,
 * sólo el último termina emitiéndose.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(
    () => scheduleDebounce(value, delayMs, setDebounced),
    [value, delayMs],
  );
  return debounced;
}
