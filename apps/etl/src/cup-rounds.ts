/**
 * Numeración de orden de las rondas de eliminatoria a partir del nombre que
 * publica la fuente (thead.head_jornada). Ordena las columnas del bracket.
 *
 * Módulo puro (sin acceso a BD ni efectos) para poder testearlo: run-pipeline
 * importa `main()` y ejecutarse en import impide testear nada definido allí.
 */

/** Número de orden de una ronda de copa/bracket genérico por su nombre. */
export function cupRoundNumber(name: string): number {
  const n = name.toLowerCase();
  if (/octavos|1\/8/.test(n)) return 1;
  if (/cuartos|1\/4/.test(n)) return 2;
  if (/semi/.test(n))         return 3;
  if (/final/.test(n))        return 4;
  if (/tercer|bronce|consol/.test(n)) return 5;
  return 9;
}

/**
 * Número de orden de una Final Four: Semifinal(1) → Final(2) → 3º-4º(3).
 *
 * OJO al orden de las comprobaciones: "Semifinal" también contiene "final", así
 * que la semifinal se comprueba antes. La numeración canónica de una Final Four
 * es semis=1 / final=2 (a diferencia del bracket genérico, donde la final es 4),
 * y la web decide el cuadro por el `format`, no por este número.
 */
export function finalFourRoundNumber(name: string): number {
  const n = name.toLowerCase();
  if (/semi/.test(n))                 return 1;
  if (/3.*4|tercer|bronce|consol/.test(n)) return 3;
  if (/final/.test(n))                return 2;
  return 9;
}

/**
 * Número de jornada a partir del nombre de la fuente ("JORNADA 5" → 5).
 * `null` si no hay dígitos (esa ronda se descarta). La liga regular se modela
 * como `round_type='regular'` con este número; sin ello, `rounds` queda vacío y
 * la web no puede ofrecer el filtro por jornada.
 */
export function regularRoundNumber(name: string): number | null {
  const m = /(\d+)/.exec(name);
  return m ? Number(m[1]) : null;
}
