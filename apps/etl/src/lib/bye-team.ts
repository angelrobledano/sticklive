/**
 * La fuente FEP introduce un pseudo-equipo "DESCANSO" (a veces "DESCANSO 1")
 * como bye en las ligas de número impar. No es un equipo real: no debe
 * resolverse contra `teams` ni entrar en la clasificación.
 */
export function isByeTeamName(name: string): boolean {
  return /^\s*descanso(?:\s+\d+)?\s*$/i.test(name || '');
}
