/**
 * Regresión de estado de un partido (#188, #377/P3-9).
 *
 * Las correcciones de la fuente se APLICAN (son legítimas), pero un retroceso
 * (`finished`/`live` → `scheduled`, `finished` → `live`) reabre directos y puede
 * reenviar avisos, así que se deja rastro. La regla vive en un único sitio:
 * `resolveStatusTransition` de @sports/shared-types; esto es su atajo booleano.
 */
import { resolveStatusTransition } from '@sports/shared-types';

export function isStatusRegression(prev: string | null | undefined, next: string | null | undefined): boolean {
  if (!prev || !next) return false;
  return resolveStatusTransition(prev, next).correction;
}
