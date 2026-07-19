/**
 * Lógica PURA del diff de eventos para las notificaciones push.
 *
 * Vive en su propio módulo, sin importar nada, a propósito: `push-dispatcher.ts`
 * arrastra el cliente de PostgreSQL, que lanza al cargarse si no hay
 * DATABASE_URL. Separando el cálculo de la E/S, esto se puede testear sin base
 * de datos, sin red y sin entorno.
 */

export interface EventSnap {
  /**
   * UUID del evento en match_events. Es la CLAVE del diff.
   *
   * Antes esto se diffeaba por CONTEO agregado por (partido, jugador), porque
   * la ficha reescribía los eventos con DELETE + INSERT y los ids cambiaban en
   * cada ciclo. Ese enfoque perdía notificaciones: si la fuente corregía el
   * acta dentro del mismo ciclo (quita un evento y añade otro), el conteo no
   * variaba y no se emitía nada. Desde la migración 034 los ids son estables
   * (upsert por source_ref), así que diffeamos por identidad: exacto.
   */
  eventId: string;
  matchId: string;
  playerId: string | null;
  playerName: string;
  scorerTeamId: string | null;   // equipo del goleador (para copy de tarjeta)
  scorerTeamShort?: string | null; // abreviatura del equipo (para copy de tarjeta)
  competitionId: string | null;  // competición (segmentación por liga)
  homeTeamId: string | null;     // equipos del partido (segmentación: sigues a cualquiera)
  awayTeamId: string | null;
  homeShort: string;
  awayShort: string;
  homeScore: number;
  awayScore: number;
  minute: number | null;         // minuto transcurrido DE ESTE evento (ya no un MAX agregado)
}

/**
 * Eventos NUEVOS entre dos snapshots: los que aparecen ahora y no estaban
 * antes, comparados por id de evento.
 *
 * Con ids estables (migración 034) detecta también el caso que antes se
 * escapaba: la fuente corrige el acta dentro del mismo ciclo sustituyendo un
 * evento por otro — el conteo agregado no cambiaba y la notificación se perdía.
 *
 * Se ordena por minuto para que, si un ciclo trae varios eventos de golpe, las
 * notificaciones salgan en el orden en que ocurrieron.
 */
export function freshEvents(
  prev: Map<string, EventSnap>,
  cur: Map<string, EventSnap>,
): EventSnap[] {
  const out: EventSnap[] = [];
  for (const [eventId, now] of cur) {
    if (!prev.has(eventId)) out.push(now);
  }
  return out.sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));
}

/**
 * Un evento por (partido, jugador): se queda con el último de la lista, que
 * con la entrada ordenada por minuto es el de minuto más avanzado.
 *
 * Conserva la semántica del diff por conteo anterior: si un jugador marca dos
 * veces dentro del mismo ciclo (~45 s), sale UNA notificación y no dos. Con el
 * mismo `tag` el dispositivo sólo mostraría la última de todas formas, pero
 * evita el doble aviso.
 */
export function collapsePerScorer(events: EventSnap[]): EventSnap[] {
  const byScorer = new Map<string, EventSnap>();
  for (const ev of events) byScorer.set(`${ev.matchId}:${ev.playerId ?? 'np'}`, ev);
  return [...byScorer.values()];
}
