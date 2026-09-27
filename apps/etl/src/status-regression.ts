/**
 * Regresión de estado de un partido (#188).
 *
 * `upsertMatch` aplica `status = EXCLUDED.status` sin condiciones (las
 * correcciones de la fuente son legítimas y no se bloquean), pero un glitch del
 * feed que devuelve `finished`/`live` a `scheduled` no dejaba rastro. Este
 * predicado puro decide cuándo avisar.
 */
export function isStatusRegression(prev: string | null | undefined, next: string): boolean {
  return (prev === 'finished' || prev === 'live') && next === 'scheduled';
}
