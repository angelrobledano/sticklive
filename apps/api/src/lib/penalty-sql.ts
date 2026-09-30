/**
 * Condición SQL compartida de "penalti marcado" (#218).
 *
 * La heurística vive aquí para que player-detail, team-detail y season-stats
 * cuenten EXACTAMENTE lo mismo: antes cada endpoint tenía su propia lista de
 * variantes (4 vs 2) y un mismo partido podía contar distinto en la ficha del
 * jugador que en la del equipo. `alias` es el alias SQL de match_events en la
 * consulta que lo usa (constante interna, nunca input del usuario).
 */
export function penaltyScoredSql(alias = 'e'): string {
  return `(${alias}.detail ILIKE '%gol%' OR ${alias}.detail ILIKE '%marc%' OR ${alias}.detail ILIKE '%anotado%' OR ${alias}.detail ILIKE '%dentro%')`;
}
