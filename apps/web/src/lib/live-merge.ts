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
