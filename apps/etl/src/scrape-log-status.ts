/**
 * Estado que deja un run de scraping en `scrape_logs` cuando el loader NO llega
 * a escribir (auditoría #329).
 *
 * El loader (match/standing) registra su fila al final, así que sólo queda
 * rastro si llega a ejecutarse. Pero los orquestadores saltan el loader cuando
 * el scrape falla o devuelve 0 filas — y hasta ahora ese run era invisible:
 * sin fila en scrape_logs ni aviso (fue exactamente el mecanismo de la fuente
 * World Skate muerta 15 días sin señal, #314/#294).
 *
 * Regla:
 *   · scrape fallido           → 'error'   (scrape-health-watch alerta; el
 *     orquestador además lo manda a Sentry con el patrón de run-worldskate).
 *   · éxito con 0 filas        → 'success' con records_found=0 (la alerta
 *     'zero' del vigilante detecta el "éxito silencioso": la fuente cambió).
 *   · éxito con 0 filas pero ESPERADO (clasificaciones de copas/eliminatorias,
 *     que devuelven vacío de fábrica) → 'skipped' (no alerta; mismo trato que
 *     las ediciones dormidas de World Skate).
 */
export type ScrapeRunStatus = 'success' | 'error' | 'skipped';

export function scrapeRunStatus(
  success: boolean,
  recordsFound: number,
  expectedEmpty: boolean
): ScrapeRunStatus {
  if (!success) return 'error';
  if (recordsFound === 0 && expectedEmpty) return 'skipped';
  return 'success';
}
