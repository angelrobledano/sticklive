import { STALE_LIVE_HOURS as DEFAULT_STALE_LIVE_HOURS } from '@sports/shared-types';

/**
 * Estado del partido que se EXPONE al cliente.
 *
 * La API "adelanta" a `live` un partido cuyo saque ya pasó pero que la fuente
 * aún no ha marcado como en juego (lag de ~1 min del feed). Ese adelanto se acota
 * con `STALE_LIVE_HOURS` — los mismos que usa el `stale-live-watchdog` del ETL
 * para degradar a `scheduled` los zombis: sin tope, un partido fantasma se
 * pintaba EN VIVO indefinidamente y anulaba al watchdog (issue #150).
 *
 * Antes esta lógica estaba duplicada en match-detail y match-stream. El valor por
 * defecto es único (#191, `@sports/shared-types`); el env lo puede ajustar.
 */
const STALE_LIVE_HOURS = Number(process.env['STALE_LIVE_HOURS'] ?? DEFAULT_STALE_LIVE_HOURS);
const TERMINALES = new Set(['finished', 'postponed', 'cancelled']);

export function effectiveMatchStatus(
  status: string,
  scheduledAt: Date | string | null,
  nowMs: number = Date.now(),
): string {
  if (TERMINALES.has(status)) return status;
  if (status === 'live') return 'live';

  const startMs = scheduledAt ? new Date(scheduledAt).getTime() : NaN;
  if (!Number.isFinite(startMs)) return status;

  const dentro = nowMs >= startMs && nowMs - startMs < STALE_LIVE_HOURS * 3_600_000;
  return dentro ? 'live' : status;
}
