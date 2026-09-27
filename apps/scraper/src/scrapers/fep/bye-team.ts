/**
 * Pseudo-equipo de bye.
 *
 * La fuente (sidgad) mete un equipo con nombre "DESCANSO" como rival en la fila
 * de descanso de las ligas de número impar (verificado en Bronce N/S 2026/27:
 * `refs=[team_3742,team_3769] names=[... vs DESCANSO]`). Esa fila NO es un
 * partido: el calendario debe omitirla, no emitirla y dejar que el ETL la
 * descarte por equipo no resoluble (que además encola "DESCANSO" en la cola HITL
 * y ensucia los logs en cada ciclo).
 *
 * Función pura y aislada para poder probarla sin arrastrar el scraper (que exige
 * entorno al importarse).
 */
export const isByeTeamName = (name: string | null | undefined): boolean =>
  /^\s*descanso\s*$/i.test(name ?? '');
