import type { Match } from '@/lib/api/client';

/**
 * Fusiona una lista nueva de partidos con la anterior **conservando la
 * identidad** de los que no han cambiado.
 *
 * El sondeo del directo devuelve objetos nuevos en cada respuesta. Sin esta
 * fusión, cada poll (~25 s) reemplazaba el array completo y forzaba a React a
 * re-renderizar todas las filas de la jornada, aunque solo hubiera cambiado un
 * marcador. Con referencias estables, `React.memo` puede saltarse las filas
 * intactas y, si no cambia nada, ni siquiera se actualiza el estado.
 *
 * Compara por contenido (no por identidad) porque los DTO llegan de `fetch`.
 * Función pura: no toca estado ni red.
 */
function sameMatch(a: Match, b: Match): boolean {
  // JSON.stringify es suficiente aquí: los DTO son objetos planos pequeños y
  // se construyen siempre con el mismo orden de claves (normalize*), así que
  // dos partidos iguales producen la misma cadena. Evita mantener a mano una
  // comparación campo a campo que se desincronice al crecer el DTO.
  return JSON.stringify(a) === JSON.stringify(b);
}

export function mergeMatchList(previous: Match[], next: Match[]): Match[] {
  const byId = new Map(previous.map((match) => [match.id, match]));
  let changed = previous.length !== next.length;

  const merged = next.map((match, index) => {
    const old = byId.get(match.id);
    if (old && sameMatch(old, match)) {
      // Mismo partido en la misma posición: reutiliza el objeto anterior.
      if (previous[index] !== old) changed = true;
      return old;
    }
    changed = true;
    return match;
  });

  // Sin cambios devolvemos el array anterior: React puede abortar el render.
  return changed ? merged : previous;
}

/**
 * Aplica el feed de directos (`/matches/live`, ~2 KB) sobre la lista de la
 * jornada sin volver a descargar el listado completo (~478 KB por sondeo).
 *
 * Solo parchea partidos ya conocidos. Pide reconciliar con el listado completo
 * cuando el feed no basta: un directo que ya no aparece (ha terminado: el
 * marcador final lo da `/matches/current`, aquí no se inventa) o un directo
 * que no está en la lista. Función pura.
 */
export function patchWithLive(previous: Match[], live: Match[]): { matches: Match[]; needsReconcile: boolean } {
  const liveById = new Map(live.map((m) => [m.id, m]));
  const known = new Set(previous.map((m) => m.id));
  let needsReconcile = live.some((m) => !known.has(m.id));
  let changed = false;

  const matches = previous.map((old) => {
    const fresh = liveById.get(old.id);
    if (!fresh) {
      if (old.status === 'live') needsReconcile = true;
      return old;
    }
    if (sameMatch(old, fresh)) return old;
    changed = true;
    return fresh;
  });

  return { matches: changed ? matches : previous, needsReconcile };
}

/** Mínimo entre dos descargas del listado completo cuando el feed las pide. */
export const RECONCILE_MIN_MS = 60_000;
/** Reconciliación de seguridad (aplazamientos, finales sin pasar por directo…). */
export const RECONCILE_MAX_MS = 5 * 60_000;

/** ¿Toca descargar el listado completo? Pura: el hook pone los tiempos. */
export function shouldReconcile(needed: boolean, lastAt: number, now: number): boolean {
  const elapsed = now - lastAt;
  return elapsed >= RECONCILE_MAX_MS || (needed && elapsed >= RECONCILE_MIN_MS);
}
