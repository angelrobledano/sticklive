/**
 * Política para placeholders sintéticos (filas del calendario SIN `idp`).
 *
 * El loader descarta un placeholder con fecha pasada porque, en liga, suele ser
 * un cruce que no se jugó. En una eliminatoria el cruce sí existe aunque la
 * fuente aún no haya publicado acta/resultado: la final de la Lliga Catalana
 * 2026/27 (FECAPA 4858) venía sin `idp` y desaparecía del cuadro. Se conserva
 * para que se vea como partido pendiente/sin resultado.
 *
 * Un placeholder CON resultado nunca debe descartarse (marcador publicado sin
 * acta, p. ej. una victoria por incomparecencia).
 */
export function keepPastSynthetic(
  roundType: string | null | undefined,
  hasResult: boolean,
): boolean {
  return hasResult || roundType === 'playoff';
}
