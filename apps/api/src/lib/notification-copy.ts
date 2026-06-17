/**
 * Plantillas de copy y política de las notificaciones push.
 *
 * La ENTREGA (Web Push/VAPID + service worker + suscripciones por dispositivo)
 * aún no está montada; este módulo fija el contrato de contenido y las reglas
 * anti-intrusión para que la capa de delivery solo tenga que enchufarse aquí.
 *
 * ── Política anti-intrusión ──────────────────────────────────────────────
 * 1. SMART BUNDLING: una única notificación viva por partido. Cada evento
 *    nuevo ACTUALIZA esa notificación (mismo `tag` de Web Push = reemplazo
 *    en pantalla de bloqueo), nunca apila pushes: 3 goles seguidos = 1 push
 *    actualizado, no 3.
 * 2. SILENCIO NOCTURNO (pref quietNight): entre 23:00 y 08:00 no se emiten
 *    alertas de evento; el partido tardío genera un único resumen matinal.
 * 3. SEGMENTACIÓN: solo se notifica lo que el usuario tiene activado en su
 *    NotifConfig (switch maestro > bloque favoritos > bloque global).
 */

const SPAIN_TZ = 'Europe/Madrid';

/** Firma de marca de todas las alertas push */
export const BRAND_PREFIX = '[Stick Live]';

/** Antepone la firma de marca: `[Stick Live] ¡Gol de Barça! ...` */
export function branded(message: string): string {
  return `${BRAND_PREFIX} ${message}`;
}

export interface MatchRef {
  homeShort: string;
  awayShort: string;
  homeScore: number;
  awayScore: number;
  minute?: number | null;
}

/** Tag de Web Push: una notificación viva por partido (smart bundling) */
export function matchTag(matchId: string): string {
  return `match-${matchId}`;
}

/** `¡Gol de Barça! Ignacio Alabart pone el 1 - 2 (22')` */
export function goalAlert(teamName: string, playerName: string | null, m: MatchRef): string {
  const who = playerName ? ` ${playerName} pone el` : ' Sube el';
  const min = m.minute != null ? ` (${m.minute}')` : '';
  return `¡Gol de ${teamName}!${who} ${m.homeScore} - ${m.awayScore}${min}`;
}

/** `Tarjeta azul para Ferran Font (Barça) al minuto 22'` */
export function cardAlert(kind: 'azul' | 'roja', playerName: string, teamName: string, minute?: number | null): string {
  const min = minute != null ? ` al minuto ${minute}'` : '';
  return `Tarjeta ${kind} para ${playerName} (${teamName})${min}`;
}

/** Tag de jornada (una notificación viva por ronda y fase). */
export function jornadaTag(roundId: string, phase: 'start' | 'end'): string {
  return `jornada-${roundId}-${phase}`;
}

/** Tag de jugador (una notificación viva por jugador). */
export function playerTag(playerId: string): string {
  return `player-${playerId}`;
}

/** `¡Arranca la Jornada 26! Sigue todos los partidos en directo.` */
export function jornadaStartAlert(roundName: string): string {
  return `¡Arranca la ${roundName}! Sigue todos los partidos en directo.`;
}

/** `La Jornada 26 ha terminado. Consulta resultados y clasificación.` */
export function jornadaEndAlert(roundName: string): string {
  return `La ${roundName} ha terminado. Consulta resultados y clasificación.`;
}

/** `⚽ ¡Gol de Pablo Álvarez! BAR 2 - 1 IHC` (jugador favorito) */
export function playerGoalAlert(playerName: string, m: MatchRef): string {
  return `⚽ ¡Gol de ${playerName}! ${m.homeShort} ${m.homeScore} - ${m.awayScore} ${m.awayShort}`;
}

/** Cuerpo de la notificación viva del partido: `[LIVE] BAR 3 - 1 IHC (Min. 34')` */
export function liveBody(m: MatchRef): string {
  const min = m.minute != null ? ` (Min. ${m.minute}')` : '';
  return `[LIVE] ${m.homeShort} ${m.homeScore} - ${m.awayScore} ${m.awayShort}${min}`;
}

/** `Final: BAR 2 - 1 IHC. Ver resumen y estadísticas.` */
export function finalAlert(m: MatchRef): string {
  return `Final: ${m.homeShort} ${m.homeScore} - ${m.awayScore} ${m.awayShort}. Ver resumen y estadísticas.`;
}

/** Resumen matinal para partidos silenciados por la noche */
export function morningSummary(winnerName: string, m: MatchRef, kickoffLocal: string): string {
  return `Buenos días. Ayer el ${winnerName} venció ${m.homeScore}-${m.awayScore} en el partido de las ${kickoffLocal}.`;
}

/** ¿Estamos en la ventana de silencio nocturno (23:00–08:00 España)? */
export function isQuietHours(date: Date = new Date()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('es-ES', { hour: 'numeric', hour12: false, timeZone: SPAIN_TZ }).format(date)
  );
  return hour >= 23 || hour < 8;
}
