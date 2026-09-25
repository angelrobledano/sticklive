/**
 * Detección de "éxito silencioso" del scraping (auditoría I3).
 *
 * Sentry ya captura los ERRORES del ETL. El hueco es el caso en que un scraper
 * termina con status='success' pero devuelve 0 filas (la fuente cambió el HTML/
 * API y ya no encuentra nada), o directamente deja de correr. Ninguno de esos
 * es un error, así que nada avisa y la web se queda con datos obsoletos hasta
 * que un usuario lo nota.
 *
 * Esta función es PURA: recibe el estado (ahora + último resumen por scraper) y
 * devuelve las alertas. El runner (scrape-health-watch.ts) hace la E/S: lee
 * scrape_logs y envía cada alerta a Sentry como warning.
 */

export interface ScrapeSummary {
  scraperKey: string;
  entityType: string;
  lastScrapedAt: Date;
  lastStatus: 'success' | 'error' | 'skipped' | 'partial';
  lastRecordsFound: number | null;
}

export interface ScrapeHealthConfig {
  /** Umbral en horas: si el último run es más viejo, se considera "parado". */
  staleHours: number;
  /** scraper_key que DEBEN existir; si falta alguno del todo → alerta 'missing'. */
  expectedKeys?: string[];
}

export type ScrapeAlert =
  | { kind: 'stale'; scraperKey: string; entityType: string; ageHours: number }
  | { kind: 'zero'; scraperKey: string; entityType: string }
  | { kind: 'missing'; scraperKey: string };

export function evaluateScrapeHealth(
  now: Date,
  summaries: ScrapeSummary[],
  config: ScrapeHealthConfig,
): ScrapeAlert[] {
  const alerts: ScrapeAlert[] = [];

  for (const s of summaries) {
    const ageHours = (now.getTime() - s.lastScrapedAt.getTime()) / 3_600_000;
    if (ageHours > config.staleHours) {
      // Parado: no llegó a correr en el plazo. Tiene prioridad sobre 'zero'
      // (un run viejo con 0 filas es primero un problema de que no corre).
      alerts.push({ kind: 'stale', scraperKey: s.scraperKey, entityType: s.entityType, ageHours });
      continue;
    }
    // Éxito silencioso: corrió reciente, dijo OK, pero no trajo nada.
    if (s.lastStatus === 'success' && s.lastRecordsFound === 0) {
      alerts.push({ kind: 'zero', scraperKey: s.scraperKey, entityType: s.entityType });
    }
    // Los errores (status='error') NO se alertan aquí: ya los captura Sentry
    // por la vía de captureException del propio ETL.
  }

  // Scrapers que deberían existir y no aparecen ni una vez.
  if (config.expectedKeys?.length) {
    const vistos = new Set(summaries.map((s) => s.scraperKey));
    for (const key of config.expectedKeys) {
      if (!vistos.has(key)) alerts.push({ kind: 'missing', scraperKey: key });
    }
  }

  return alerts;
}

/** Mensaje legible para Sentry/logs a partir de una alerta. */
export function alertMessage(a: ScrapeAlert): string {
  switch (a.kind) {
    case 'stale':
      return `Scraper '${a.scraperKey}/${a.entityType}' sin correr desde hace ${a.ageHours.toFixed(1)} h (parado)`;
    case 'zero':
      return `Scraper '${a.scraperKey}/${a.entityType}' terminó OK pero con 0 resultados (posible cambio de la fuente)`;
    case 'missing':
      return `Scraper esperado '${a.scraperKey}' no tiene ninguna ejecución registrada`;
  }
}
