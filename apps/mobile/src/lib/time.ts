import { STALE_LIVE_HOURS } from '@sports/shared-types';

const MADRID = 'Europe/Madrid';

export function formatKickoff(iso: string | null): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--'; // paridad con la web (match-time.ts)
  return new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit', minute: '2-digit', timeZone: MADRID, hour12: false,
  }).format(d);
}

export function formatDayLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ''; // paridad con la web (match-time.ts)
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'long', day: 'numeric', month: 'short', timeZone: MADRID,
  }).format(d);
}

/**
 * "En juego por reloj": misma regla que la web (MatchCard) y el API
 * (effective-status): un partido scheduled dentro de las STALE_LIVE_HOURS tras
 * el saque se pinta EN DIRECTO. Fuente única en @sports/shared-types.
 */
export function isEffectivelyLive(status: string, scheduledAt: string | null): boolean {
  if (status === 'live' || status === 'halftime' || status === 'overtime' || status === 'penalty_shootout') return true;
  if (status !== 'scheduled' || !scheduledAt) return false;
  const elapsedHours = (Date.now() - new Date(scheduledAt).getTime()) / 3_600_000;
  return elapsedHours >= 0 && elapsedHours < STALE_LIVE_HOURS;
}
