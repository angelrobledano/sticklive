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
 *    alertas de evento. Los finales que caen en esa ventana se compensan a la
 *    mañana con UN único `morningSummary` agrupado (`push-dispatcher`), para no
 *    perder el resultado ni despertar a nadie.
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

/**
 * Quita la firma de marca. Se usa SOLO en el canal nativo: el sistema ya
 * muestra el nombre de la app junto al aviso, así que repetirlo en el título
 * es ruido. El canal web (y la copia que comparten) conserva `branded()`.
 */
export function stripBrand(message: string): string {
  if (!message.startsWith(BRAND_PREFIX)) return message;
  return message.slice(BRAND_PREFIX.length).replace(/^\s+/, '');
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

/** `🎯 Falta directa · Barça (min 22')` */
export function directFoulAlert(teamName: string, minute?: number | null): string {
  const min = minute != null ? ` (min ${minute}')` : '';
  const team = teamName ? ` · ${teamName}` : '';
  return `🎯 Falta directa${team}${min}`;
}

/**
 * Azul + falta directa en una sola notificación (bundling): la tarjeta azul y la
 * falta directa que la sigue en el mismo instante se anuncian juntas.
 * `🔵 Tarjeta azul para Sergi Aragonès (Liceo) al minuto 22'. Barça dispone de falta directa.`
 */
export function blueCardWithFoulAlert(
  playerName: string, cardedTeam: string, opponentTeam: string, minute?: number | null,
): string {
  const min = minute != null ? ` al minuto ${minute}'` : '';
  const team = cardedTeam ? ` (${cardedTeam})` : '';
  const opp = opponentTeam || 'El rival';
  return `🔵 Tarjeta azul para ${playerName}${team}${min}. ${opp} dispone de falta directa.`;
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

/** `🏑 ¡Gol de Pablo Álvarez! BAR 2 - 1 IHC (12')` */
export function playerGoalAlert(playerName: string, m: MatchRef): string {
  const min = m.minute != null ? ` (${m.minute}')` : '';
  return `🏑 ¡Gol de ${playerName}! ${m.homeShort} ${m.homeScore} - ${m.awayScore} ${m.awayShort}${min}`;
}

/**
 * Contexto deportivo del gol: empate, ventaja, remontada, recorte o ampliación.
 * Aporta personalidad deportiva clara y fidedigna al evento real sin duplicar alertas.
 */
export function goalContextText(
  scoringTeamSide: 'home' | 'away',
  m: MatchRef,
  prevHomeScore?: number,
  prevAwayScore?: number,
): string {
  if (m.homeScore === m.awayScore) {
    return '¡Empate en el marcador!';
  }

  const isHomeScorer = scoringTeamSide === 'home';
  const scorerScore = isHomeScorer ? m.homeScore : m.awayScore;
  const rivalScore = isHomeScorer ? m.awayScore : m.homeScore;

  if (prevHomeScore !== undefined && prevAwayScore !== undefined) {
    const prevScorerScore = isHomeScorer ? prevHomeScore : prevAwayScore;
    const prevRivalScore = isHomeScorer ? prevAwayScore : prevHomeScore;

    // Si antes iba perdiendo y ahora pasa a ganar: remontada
    if (prevScorerScore < prevRivalScore && scorerScore > rivalScore) {
      return '¡Remontada en el marcador!';
    }
  }

  // Si pasa de empate a ganar por 1 gol: se adelanta
  if (scorerScore === rivalScore + 1) {
    return 'Se adelanta en el marcador';
  }

  // Si ya iba ganando y aumenta el margen
  if (scorerScore > rivalScore) {
    return 'Amplía la ventaja';
  }

  // Si iba perdiendo y anota
  return 'Recorta distancias';
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

/** `⏱️ HCL y IHC jugarán prórroga tras empatar 2-2.` */
export function overtimeStartAlert(m: MatchRef): string {
  return `⏱️ ${m.homeShort} y ${m.awayShort} jugarán prórroga tras empatar ${m.homeScore}-${m.awayScore}.`;
}

/** `🎯 El HCL-IHC se decide en los penaltis.` */
export function penaltyStartAlert(m: MatchRef): string {
  return `🎯 El ${m.homeShort}-${m.awayShort} se decide en los penaltis.`;
}

/** `🏁 IHC gana 4-3 en la prórroga.` */
export function finalOvertimeAlert(m: MatchRef, winnerShort: string): string {
  return `🏁 ${winnerShort} gana ${m.homeShort} ${m.homeScore}-${m.awayScore} ${m.awayShort} en la prórroga.`;
}

/** `🏁 IHC se lleva los penaltis (0-2) tras el 2-2.` */
export function finalPenaltiesAlert(m: MatchRef, winnerShort: string, penText: string): string {
  return `🏁 ${winnerShort} se lleva los penaltis (${penText}) tras el ${m.homeShort} ${m.homeScore}-${m.awayScore} ${m.awayShort}.`;
}

/** `Descanso · BAR 2 - 1 IHC` */
export function halftimeAlert(m: MatchRef): string {
  return `Descanso · ${m.homeShort} ${m.homeScore} - ${m.awayScore} ${m.awayShort}`;
}

/** `¡Comienza la 2ª parte! BAR 2 - 1 IHC` */
export function secondHalfAlert(m: MatchRef): string {
  return `¡Comienza la 2ª parte! ${m.homeShort} ${m.homeScore} - ${m.awayScore} ${m.awayShort}`;
}

/** Un resultado nocturno que entra en el resumen matinal. */
export interface MorningResult {
  homeShort: string;
  awayShort: string;
  homeScore: number;
  awayScore: number;
  /** Hora local del saque (Europe/Madrid), formato `HH:MM`. */
  kickoffLocal: string;
}

/**
 * Resumen matinal para los finales silenciados por la noche (pref quietNight).
 * Agrupa VARIOS partidos en UN único mensaje para no apilar notificaciones al
 * despertar: `Buenos días. Anoche: BAR 3-1 IHC (22:30) · LIC 2-2 OLI (21:00).`
 */
export function morningSummary(results: readonly MorningResult[]): string {
  if (results.length === 0) return 'Buenos días. Anoche no hubo partidos que resaltar.';
  const parts = results.map(
    (r) => `${r.homeShort} ${r.homeScore}-${r.awayScore} ${r.awayShort} (${r.kickoffLocal})`
  );
  return `Buenos días. Anoche: ${parts.join(' · ')}.`;
}

/** Tag de Web Push del resumen matinal: uno por día → reemplaza, nunca apila. */
export function morningSummaryTag(localDate: string): string {
  return `morning-${localDate}`;
}

/**
 * Clave de fecha local de Madrid (`YYYY-MM-DD`). La usamos como identidad del
 * resumen diario: una sola emisión por noche y dispositivo.
 */
export function madridDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SPAIN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

/** ¿Estamos en la ventana de envío del resumen matinal (08:00–12:00 España)? */
export function isMorningHours(date: Date = new Date()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('es-ES', { hour: 'numeric', hour12: false, timeZone: SPAIN_TZ }).format(date)
  );
  return hour >= 8 && hour < 12;
}

/** ¿Estamos en la ventana de silencio nocturno (23:00–08:00 España)? */
export function isQuietHours(date: Date = new Date()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('es-ES', { hour: 'numeric', hour12: false, timeZone: SPAIN_TZ }).format(date)
  );
  return hour >= 23 || hour < 8;
}
