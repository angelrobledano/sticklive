/**
 * Cesión del directo. cron-live tiene el lock global de ingesta mientras hay
 * partidos en ventana, y el scheduler es secuencial: con base de 9 portales un
 * fin de semana entero, la pasada horaria (calendario, clasificación, escudos)
 * no entraba en horas. Cada LIVE_YIELD_MIN el directo sale con este código, el
 * scheduler hace lo que le toque y vuelve a entrar sin la pausa de 5 min.
 */
export const LIVE_YIELD_EXIT_CODE = 3;

export type LoopDecision = 'continue' | 'yield' | 'stop';

/** Qué hace el bucle activo tras un ciclo. `maxMs` es el tope de seguridad de siempre. */
export function loopDecision(elapsedMs: number, yieldMs: number, maxMs: number): LoopDecision {
  if (elapsedMs > maxMs) return 'stop';
  if (yieldMs > 0 && elapsedMs > yieldMs) return 'yield';
  return 'continue';
}
