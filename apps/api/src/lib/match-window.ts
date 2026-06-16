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

export function resolveCurrentWindow(q: {
  days?: string;
  from?: string;
  to?: string;
}): CurrentWindow {
  if (ISO_DATE.test(q.from ?? '') && ISO_DATE.test(q.to ?? '')) {
    return { kind: 'range', from: q.from!, to: q.to! };
  }
  const n = Number(q.days);
  const daysN = q.days && Number.isFinite(n) && n > 0 ? Math.min(120, Math.floor(n)) : 0;
  return { kind: 'relative', backDays: daysN || 8, fwdDays: daysN || 15 };
}
