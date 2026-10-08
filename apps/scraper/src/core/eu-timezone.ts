/**
 * Conversión hora local → UTC. `zonedToUtc` usa la base de datos IANA del
 * runtime para cualquier zona; `euZonedToUtc`/`winterOffsetOf` quedan como
 * utilidades de la regla UE (sin dependencias) para quien pase un offset.
 *
 * Todas las zonas de la UE cambian el reloj a la vez (último domingo de marzo a
 * las 01:00 UTC → verano; último domingo de octubre a las 01:00 UTC → invierno).
 * Solo cambia el offset base entre zonas:
 *   - Europe/Madrid: invierno +1 (CET),  verano +2 (CEST)
 *   - Europe/Lisbon: invierno  0 (WET),  verano +1 (WEST)
 *
 * Generaliza el antiguo `madridToUtc` para soportar sedes itinerantes (los
 * europeos de World Skate cambian de país cada edición).
 */

/** Offset base de invierno (horas) por zona IANA soportada. */
const WINTER_OFFSET: Record<string, number> = {
  'Europe/Lisbon': 0,
  'Europe/London': 0,
  'Europe/Madrid': 1,
  'Europe/Paris': 1,
  'Europe/Rome': 1,
  'Europe/Berlin': 1,
  'Europe/Zurich': 1,
  'Europe/Andorra': 1,
};

/** Offset de invierno de una zona; por defecto CET (+1) si no está mapeada. */
export function winterOffsetOf(timezone: string | undefined | null): number {
  if (!timezone) return 1;
  return WINTER_OFFSET[timezone] ?? 1;
}

/** Último domingo del mes `mo` (0-based) del año `y`, calculado en UTC puro. */
function lastSundayOf(y: number, mo: number): number {
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const dow = new Date(Date.UTC(y, mo, lastDay)).getUTCDay(); // 0 = domingo
  return lastDay - dow;
}

/**
 * Convierte una fecha/hora expresada en una zona de la UE a un Date UTC.
 * `winterOffset` es el offset base en invierno (0 para Lisboa, 1 para Madrid…);
 * en verano se le suma 1.
 */
export function euZonedToUtc(
  year: number, month: number, day: number, hour: number, min: number,
  winterOffset: number
): Date {
  const dstStart = Date.UTC(year, 2, lastSundayOf(year, 2), 1, 0, 0); // marzo → 01:00 UTC
  const dstEnd = Date.UTC(year, 9, lastSundayOf(year, 9), 1, 0, 0);   // octubre → 01:00 UTC

  // Las fronteras se comparan en hora LOCAL, no en UTC aproximada: el cambio de
  // primavera ocurre a las 02:00 locales (01:00 UTC) y el de otoño a las 03:00
  // locales de verano (= 02:00 locales de invierno). Comparando en UTC, un
  // partido a las 01:30 local del día del cambio se iba a CEST (una hora menos).
  // Issue #175.
  const localApprox   = Date.UTC(year, month, day, hour, min, 0);
  const dstStartLocal = dstStart + winterOffset * 3_600_000;
  const dstEndLocal   = dstEnd + (winterOffset + 1) * 3_600_000;
  const inDst = localApprox >= dstStartLocal && localApprox < dstEndLocal;
  const offset = winterOffset + (inDst ? 1 : 0);

  const d = new Date(localApprox - offset * 3_600_000);
  return isNaN(d.getTime()) ? new Date(NaN) : d;
}

const DEFAULT_ZONE = 'Europe/Madrid';
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Formateador por zona (lanza RangeError si la zona IANA no existe). */
function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(timezone, f);
  }
  return f;
}

/** Hora local de un instante en la zona, expresada como ms "UTC de pared". */
function wallClockMs(timezone: string, utcMs: number): number {
  const parts = formatterFor(timezone).formatToParts(new Date(utcMs));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
}

function isValidZone(timezone: string): boolean {
  try { formatterFor(timezone); return true; } catch { return false; }
}

/**
 * Convierte una fecha/hora LOCAL de la zona IANA indicada a UTC, usando la base
 * de datos de zonas del runtime (Intl/ICU). Vale para cualquier sede (Europa,
 * Asunción, Brasil…) sin tablas a mano que se quedan viejas: Paraguay pasó a
 * UTC-3 permanente en 2024 y la tabla fija lo seguía dando en UTC-4.
 *
 * Casos borde del cambio de hora (mismo contrato que la versión UE, #175):
 *   - hora inexistente (salto de primavera): se interpreta con el offset de
 *     verano;
 *   - hora ambigua (vuelta de otoño): se elige la PRIMERA ocurrencia.
 * Zona nula o desconocida → Europe/Madrid (la de la fuente por defecto).
 */
export function zonedToUtc(
  timezone: string | undefined | null,
  year: number, month: number, day: number, hour: number, min: number
): Date {
  const tz = timezone && isValidZone(timezone) ? timezone : DEFAULT_ZONE;
  const local = Date.UTC(year, month, day, hour, min, 0);
  if (Number.isNaN(local)) return new Date(NaN);
  // Offsets alrededor del instante: antes y después de un posible cambio de hora.
  const offsets = [...new Set([
    wallClockMs(tz, local - 6 * 3_600_000) - (local - 6 * 3_600_000),
    wallClockMs(tz, local + 6 * 3_600_000) - (local + 6 * 3_600_000),
  ])];
  const matches = offsets.map((o) => local - o).filter((t) => wallClockMs(tz, t) === local);
  if (matches.length > 0) return new Date(Math.min(...matches));
  return new Date(local - Math.max(...offsets));
}
