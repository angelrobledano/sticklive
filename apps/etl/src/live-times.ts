/**
 * Sellos temporales del flujo de directo (#189, #377/P3-11).
 *
 * El loader sella `started_at`/`finished_at` la PRIMERA vez que ve el partido en
 * ese estado (y el upsert los conserva con COALESCE). Antes, un partido que sólo
 * se vio `finished` (el feed nunca lo listó `live`) quedaba con `started_at`
 * NULL: 22/22 finalizados de un día en producción. Afecta a ordenaciones y
 * analytics. La mejor aproximación disponible es su hora programada.
 *
 * Puro y testeable; el loader decide si aplica (sólo directo, nunca histórico).
 */
export interface LiveTimeStamps {
  startedAt?: Date;
  finishedAt?: Date;
}

export function resolveLiveTimeStamps(
  status: string,
  scheduledAt: Date | undefined,
  at: Date,
): LiveTimeStamps {
  if (status === 'live') return { startedAt: at };
  if (status === 'finished') {
    // Si nunca se vio live no hay instante real de saque; `scheduled_at` es la
    // mejor aproximación (y el COALESCE del upsert sólo rellena si era NULL).
    return scheduledAt ? { startedAt: scheduledAt, finishedAt: at } : { finishedAt: at };
  }
  return {};
}
