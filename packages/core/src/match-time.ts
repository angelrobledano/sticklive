import { matchDisplayState } from '@sports/shared-types';

/**
 * match-time.ts — autoridad horaria ÚNICA de la app.
 *
 * El calendario oficial (FEP y ligas ES/PT/FR/IT) se publica en hora peninsular
 * española y el backend guarda los timestamps en UTC (columnas TIMESTAMPTZ, el
 * scraper convierte Madrid→UTC). Por tanto el front debe agrupar los partidos y
 * anclar el concepto de "hoy" SIEMPRE en Europe/Madrid.
 *
 * El bug que esto corrige: la vista anclaba "hoy" con `new Date()` (hora LOCAL
 * del dispositivo en cliente, y UTC en el render SSR porque Docker corre en UTC)
 * mientras que los partidos se agrupaban en hora de Madrid. Tres relojes
 * distintos ⇒ la clave del día seleccionado no casaba con la de ningún partido
 * y "los partidos de hoy" desaparecían o caían en el día equivocado.
 *
 * Regla: cualquier cálculo de día/hoy/agrupación pasa por aquí. Nada de
 * `new Date().getDate()` ni `toLocaleDateString('es-ES')` suelto.
 */

export const APP_TZ = 'Europe/Madrid';

/**
 * Formatter reutilizable. `en-CA` devuelve directamente "YYYY-MM-DD", así que
 * no hay que parsear ni invertir un string localizado (frágil entre runtimes).
 */
const DATE_KEY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Clave de día "YYYY-MM-DD" de un instante UTC, expresado en hora de Madrid. */
export function madridDateKey(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return DATE_KEY_FMT.format(d);
}

/**
 * Clave de "hoy" en Madrid. Estable e idéntica en cliente, en el render SSR
 * (servidor en UTC) y bajo cualquier zona horaria del dispositivo ⇒ sin
 * desajustes de hidratación.
 */
export function madridTodayKey(now: Date = new Date()): string {
  return DATE_KEY_FMT.format(now);
}

/**
 * Suma `delta` días a una clave "YYYY-MM-DD". Trabaja en UTC a mediodía, que es
 * inmune a los saltos de horario de verano (DST): nunca cae en la hora fantasma.
 */
export function addDaysToKey(key: string, delta: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Diferencia en días enteros entre dos claves "YYYY-MM-DD" (a − b). */
export function dayDiff(a: string, b: string): number {
  const ta = Date.parse(`${a}T12:00:00Z`);
  const tb = Date.parse(`${b}T12:00:00Z`);
  return Math.round((ta - tb) / 86_400_000);
}

export type TemporalBucket = 'past' | 'live' | 'future';

interface ClassifiableMatch {
  status: string;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt?: string | null;
}

/**
 * Clasifica un partido en pasado / en juego / futuro.
 *
 * "En juego" SOLO si la fuente lo da en juego (`status = 'live'`): la hora no
 * fabrica directos (regla única `matchDisplayState` de @sports/shared-types,
 * la misma que API, web y app). Un `scheduled` con la hora pasada sigue
 * pendiente (futuro) hasta OVERDUE_AFTER_HOURS; después es un dato muerto
 * (pasado). Aplazado/cancelado se listan en futuros con su aviso.
 */
export function classifyMatch(
  match: ClassifiableMatch,
  now: Date = new Date(),
): TemporalBucket {
  const state = matchDisplayState(match.status, match.startedAt ?? match.scheduledAt, now.getTime());
  if (state === 'live') return 'live';
  if (state === 'finished' || state === 'overdue') return 'past';
  return 'future';
}

/**
 * Hora por confirmar. Las federaciones publican a veces solo el día y el
 * scraper lo guarda como medianoche local: ningún partido empieza a las 00:00
 * (ni a la 01:00 de Madrid, medianoche en Lisboa), así que se lee como «sin hora».
 */
export function isTimeTbd(iso: string | null | undefined, venueTz?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const zones = venueTz ? [venueTz] : [APP_TZ, 'Europe/Lisbon'];
  return zones.some((tz) => {
    try {
      return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }) === '00:00';
    } catch { return false; }
  });
}

const TBD_LABEL: Record<string, string> = {
  es: 'Por confirmar', ca: 'Per confirmar', en: 'TBC', pt: 'A confirmar', fr: 'À confirmer', it: 'Da confermare',
};

/** Texto de «hora por confirmar» en el idioma dado. */
export function timeTbdLabel(locale = 'es'): string {
  return TBD_LABEL[locale.slice(0, 2)] ?? TBD_LABEL.es!;
}
