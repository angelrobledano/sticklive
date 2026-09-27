/**
 * Resolución de la ventana temporal de /matches/current (auditoría A2).
 *
 * Pura y testeable a propósito: aquí vivió el bug que dejó la home casi vacía
 * (cuando NO llegaba ?days, se colapsaba a ±1 día). El test fija el contrato.
 *
 *  - ?from=YYYY-MM-DD&to=YYYY-MM-DD → rango explícito.
 *  - ?days=N (1..120)               → ventana simétrica de N días.
 *  - nada / parámetros inválidos    → por defecto hoy-8d .. hoy+15d.
 */
export type CurrentWindow =
  | { kind: 'range'; from: string; to: string }
  | { kind: 'relative'; backDays: number; fwdDays: number };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
/** Amplitud máxima del rango explícito (?from/?to), en días. Ver issue #153. */
export const MAX_RANGE_DAYS = 90;

export function resolveCurrentWindow(q: {
  days?: string;
  from?: string;
  to?: string;
}): CurrentWindow {
  const fromRaw = ISO_DATE.test(q.from ?? '') ? q.from!.slice(0, 10) : null;
  const toRaw   = ISO_DATE.test(q.to ?? '') ? q.to!.slice(0, 10) : null;
  if (fromRaw && toRaw) {
    // Acota la amplitud y normaliza el orden: un rango arbitrario multiplicaba
    // las queries al pool (y las claves de caché). `to` se clampa a
    // from + MAX_RANGE_DAYS. Fechas inválidas caen al modo relativo.
    const fromMs = Date.parse(`${fromRaw}T00:00:00Z`);
    const toMs   = Date.parse(`${toRaw}T00:00:00Z`);
    if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
      const lo = Math.min(fromMs, toMs);
      const hi = Math.min(Math.max(fromMs, toMs), lo + MAX_RANGE_DAYS * 86_400_000);
      const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      return { kind: 'range', from: iso(lo), to: iso(hi) };
    }
  }
  const n = Number(q.days);
  const daysN = q.days && Number.isFinite(n) && n > 0 ? Math.min(120, Math.floor(n)) : 0;
  return { kind: 'relative', backDays: daysN || 8, fwdDays: daysN || 15 };
}
