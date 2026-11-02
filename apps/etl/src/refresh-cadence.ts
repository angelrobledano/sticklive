/**
 * Ritmo del calendario y la clasificación de sidgad (2/11/2026).
 *
 * Se refrescaban las ~140 competiciones cada hora, día y noche: unas 6.700
 * peticiones diarias, la mayor carga sobre sidgad (bloqueó la IP el 31/10).
 * Ahora:
 *   · con partidos en las 24 h anteriores o siguientes: cada hora;
 *   · sin ellos (reposo): cada 6 h (00, 06, 12 y 18, hora de Madrid);
 *   · de 01:00 a 05:59 (Madrid): nada.
 * Lo que mira el usuario (jornada en curso, resultados, clasificación tras la
 * jornada) sigue al ritmo de siempre. Los cambios de hora de un partido lejano
 * llegan con hasta 6 h de retraso.
 * REFRESH_ALWAYS=1 vuelve al comportamiento anterior (todas, cada hora).
 */
export function madridHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(now));
}

export function refreshDue(active: boolean, now: Date = new Date(), always = process.env['REFRESH_ALWAYS'] === '1'): boolean {
  if (always) return true;
  const h = madridHour(now);
  if (h >= 1 && h < 6) return false;
  return active || h % 6 === 0;
}
