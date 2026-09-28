/**
 * Ventana temporal de una edición de World Skate Europe (#294).
 *
 * sidgad retira la página del calendario (`worldskate_cal_idc_{idc}_1.php`)
 * poco después de terminar el torneo. Desde ese momento cada intento devuelve
 * 404 y el scheduler lo traga en silencio: en el caso real, 14 días de 404 cada
 * 5 minutos sin ninguna alerta.
 *
 * Este módulo decide, de forma PURA y testeable, si una edición sigue estando
 * "en ventana" (torneo en curso o recién terminado). La E/S (qué ediciones hay
 * en BD y qué se hace con las dormidas) vive en `run-worldskate.ts`.
 */
export interface WseSeasonWindow {
  /** Fecha de fin de la edición (ISO `YYYY-MM-DD`, Date, o null si no se sabe). */
  endDate: string | Date | null | undefined;
}

/** `YYYY-MM-DD` → fin de ese día en UTC. Un ISO completo se respeta tal cual. */
function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * ¿Sigue abierta la ventana de scraping de la edición? Se mantiene abierta
 * `graceDays` días tras `endDate` para captar las últimas actas. Sin fecha de
 * fin (o con una fecha inválida) NO se bloquea: preferimos un 404 explícito a
 * dejar una competición sin actualizar.
 */
export function isWseSeasonWindowOpen(
  now: Date,
  endDate: string | Date | null | undefined,
  graceDays: number,
): boolean {
  const end = toDate(endDate);
  if (!end) return true;
  const grace = Math.max(0, graceDays) * 86_400_000;
  return now.getTime() <= end.getTime() + grace;
}

/**
 * Separa las ediciones activas de las dormidas (torneo terminado hace más del
 * margen). Conserva el orden original. No muta la entrada.
 */
export function partitionWseSeasons<T extends WseSeasonWindow>(
  now: Date,
  seasons: readonly T[],
  graceDays: number,
): { active: T[]; dormant: T[] } {
  const active: T[] = [];
  const dormant: T[] = [];
  for (const s of seasons) {
    (isWseSeasonWindowOpen(now, s.endDate, graceDays) ? active : dormant).push(s);
  }
  return { active, dormant };
}

/**
 * ¿Toca registrar/avisar la desactivación de las ediciones dormidas? Sólo la
 * primera vez, y luego como máximo cada `reAlertHours` (evita repetir el aviso
 * en cada proceso corto del scheduler). Sin registro previo o si el último run
 * no fue un `skipped`, toca.
 */
export function isDormantReportDue(
  last: { status: string; scrapedAt: Date | string | number } | null,
  now: Date,
  reAlertHours: number,
): boolean {
  if (!last || last.status !== 'skipped') return true;
  const at = last.scrapedAt instanceof Date
    ? last.scrapedAt.getTime()
    : new Date(last.scrapedAt).getTime();
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at >= Math.max(0, reAlertHours) * 3_600_000;
}
