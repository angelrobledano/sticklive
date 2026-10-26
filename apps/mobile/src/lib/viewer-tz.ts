/**
 * Utilidades de zona horaria del espectador (paridad con web lib/viewer-tz-core.ts).
 *
 * Muestra las horas y días en la zona del dispositivo del usuario,
 * y permite detectar si la hora local del pabellón es distinta.
 */
export const DEFAULT_TZ = 'Europe/Madrid';

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function keyFmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "YYYY-MM-DD" de un instante en la zona `tz`. */
export function dateKeyIn(iso: string | null | undefined, tz: string = DEFAULT_TZ): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return keyFmt(tz).format(d);
}

/** Hoy ("YYYY-MM-DD") en la zona `tz`. */
export function todayKeyIn(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  return keyFmt(tz).format(now);
}

/** "HH:MM" del instante en `tz` (24 h). */
export function formatTimeIn(iso: string | null | undefined, tz: string = DEFAULT_TZ): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: tz,
  });
}

/** ¿La hora del pabellón (`venueTz`) es distinta de la de quien mira en ese instante? */
export function localTimeDiffers(
  iso: string | null | undefined,
  viewerTz: string,
  venueTz: string | null | undefined,
): boolean {
  if (!iso || !venueTz || venueTz === viewerTz || !isValidTimeZone(venueTz)) return false;
  return formatTimeIn(iso, viewerTz) !== formatTimeIn(iso, venueTz);
}

/** Zona del dispositivo, o la de por defecto si no está disponible. */
export function deviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}
