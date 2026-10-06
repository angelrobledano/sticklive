/**
 * date-window.ts — ventana paginada de días para el selector de fecha en
 * escritorio (#414): en vez de un carrusel de ~15 chips a todo el ancho, una
 * tira de 7 días centrada en el seleccionado con flechas que pagan de 7 en 7.
 * El móvil conserva el carrusel táctil; esto solo alimenta la tira de `md+`.
 *
 * Función pura, testeada sin navegador.
 */

export interface DateWindow {
  /** Claves visibles (≤ size), en orden. */
  keys: string[];
  /** Índice de inicio de la ventana dentro de la lista completa. */
  start: number;
  canPrev: boolean;
  canNext: boolean;
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/**
 * Ventana de `size` días. Con `startOverride` (null = auto-centrado en el
 * seleccionado) se pagina; el re-centrado al cambiar de día lo hace el
 * componente (reset del override), no esta función — paginar debe poder alejar
 * la ventana del día activo.
 */
export function computeDateWindow(
  keys: string[],
  selected: string,
  startOverride: number | null = null,
  size = 7,
): DateWindow {
  const len = keys.length;
  if (len <= size) {
    return { keys: [...keys], start: 0, canPrev: false, canNext: false };
  }
  const maxStart = len - size;
  const selIdx = keys.indexOf(selected);
  // Auto: centrado en el seleccionado (±size/2), clastrado.
  const autoStart = clamp(selIdx - Math.floor(size / 2), 0, maxStart);
  const start = clamp(startOverride ?? autoStart, 0, maxStart);
  return {
    keys: keys.slice(start, start + size),
    start,
    canPrev: start > 0,
    canNext: start < maxStart,
  };
}
