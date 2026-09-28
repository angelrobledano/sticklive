/**
 * Regresión de estado de un partido (#188).
 *
 * `upsertMatch` aplica `status = EXCLUDED.status` sin condiciones (las
 * correcciones de la fuente son legítimas y no se bloquean), pero un glitch del
 * feed que devuelve `finished`/`live` a `scheduled` no dejaba rastro. Este
 * predicado puro decide cuándo avisar.
 *
 * #377(P3-9): se añade `finished→live`. Antes ni se registraba. No se bloquea
 * (podría ser una corrección legítima tras un final adelantado), pero interesa
 * verlo: un `live` tras `finished` reabre el directo y puede reenviar avisos.
 */
const REGRESIONES_DE_ESTADO = new Set([
  'finished>scheduled',
  'live>scheduled',
  'finished>live',
]);

export function isStatusRegression(prev: string | null | undefined, next: string): boolean {
  if (!prev) return false;
  return REGRESIONES_DE_ESTADO.has(`${prev}>${next}`);
}
