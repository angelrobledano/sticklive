/**
 * Carga por día de la home (iteración 2 del plan 2026-10-25): en vez de los
 * 23 días × todo el catálogo (~3.400 partidos), se pide solo el día visible y
 * un índice ligero de días con partidos (`/matches/days`). Funciones puras.
 */
import { addDaysToKey } from '@/lib/match-time';
import { dateKeyIn } from '@/lib/viewer-tz-core';

/**
 * Rango UTC que cubre el día `dayKey` de Madrid: el API filtra por
 * `scheduled_at` en UTC ([from 00:00, to+1 00:00)), y un día de Madrid empieza
 * la víspera a las 22:00/23:00 UTC. La vista vuelve a filtrar por día de Madrid.
 */
export function dayFetchRange(dayKey: string): { from: string; to: string } {
  // ±1 día: cubre el día local de cualquier zona (Europa y también América),
  // porque la vista agrupa en la zona de quien mira.
  return { from: addDaysToKey(dayKey, -1), to: addDaysToKey(dayKey, 1) };
}

/**
 * Une listas por id sin borrar nada: lo nuevo actualiza, lo igual conserva su
 * referencia (React.memo) y lo de otros días se mantiene. Sin cambios devuelve
 * `previous`.
 */
export function mergeById<T extends { id: string }>(previous: T[], incoming: T[]): T[] {
  const index = new Map(previous.map((m, i) => [m.id, i]));
  let out: T[] | null = null;
  for (const m of incoming) {
    const i = index.get(m.id);
    if (i === undefined) {
      out ??= [...previous];
      index.set(m.id, out.length);
      out.push(m);
      continue;
    }
    const old = (out ?? previous)[i]!;
    if (JSON.stringify(old) === JSON.stringify(m)) continue;
    out ??= [...previous];
    out[i] = m;
  }
  return out ?? previous;
}

/** Ventana del selector de fechas a partir del índice de días. Hoy siempre dentro. */
export function windowFromDays(days: readonly string[], todayKey: string): { from: string | null; to: string | null } {
  if (days.length === 0) return { from: null, to: null };
  let from = days[0]!;
  let to = days[0]!;
  for (const d of days) {
    if (d < from) from = d;
    if (d > to) to = d;
  }
  if (from > todayKey) from = todayKey;
  if (to < todayKey) to = todayKey;
  return { from, to };
}

/** Primer día posterior a `afterKey` con partidos, o null. */
export function nextDayWithMatches(days: readonly string[], afterKey: string): string | null {
  let next: string | null = null;
  for (const d of days) if (d > afterKey && (next === null || d < next)) next = d;
  return next;
}

/**
 * Partidos fuera del feed del día `dayKey` en la zona `tz`, a partir del
 * recuento por hora UTC que da la API (`hiddenByHour`, spec 2026-10-30). El
 * día se pide con margen; sumar por hora evita contar los días vecinos.
 */
export function hiddenForDay(byHour: Readonly<Record<string, number>>, dayKey: string, tz: string): number {
  let n = 0;
  for (const [hour, count] of Object.entries(byHour)) {
    if (dateKeyIn(`${hour}:00:00Z`, tz) === dayKey) n += count;
  }
  return n;
}
