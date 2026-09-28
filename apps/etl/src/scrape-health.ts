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
 * scrape_logs y envía cada alerta a Sentry (error para los fallos, warning para
 * el resto).
 */

export interface ScrapeSummary {
  scraperKey: string;
  entityType: string;
  lastScrapedAt: Date;
  lastStatus: 'success' | 'error' | 'skipped' | 'partial';
  lastRecordsFound: number | null;
  /** Mensaje del último error, si lo hubo (para que la alerta sea accionable). */
  lastErrorMessage?: string | null;
}

export interface ScrapeHealthConfig {
  /** Umbral en horas: si el último run es más viejo, se considera "parado". */
  staleHours: number;
  /** scraper_key que DEBEN existir; si falta alguno del todo → alerta 'missing'. */
  expectedKeys?: string[];
}

export type ScrapeAlert =
  | { kind: 'stale'; scraperKey: string; entityType: string; ageHours: number }
  | { kind: 'error'; scraperKey: string; entityType: string; errorMessage?: string | null }
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
      // Parado: no llegó a correr en el plazo. Tiene prioridad sobre 'error' y
      // 'zero' (un run viejo es primero un problema de que no corre).
      alerts.push({ kind: 'stale', scraperKey: s.scraperKey, entityType: s.entityType, ageHours });
      continue;
    }
    // Fallo explícito del último run: la fuente respondió mal (404, 5xx, HTML
    // cambiado...). Es la señal que hoy quedaba enterrada en docker logs.
    if (s.lastStatus === 'error') {
      alerts.push({
        kind: 'error', scraperKey: s.scraperKey, entityType: s.entityType,
        ...(s.lastErrorMessage ? { errorMessage: s.lastErrorMessage } : {}),
      });
      continue;
    }
    // Éxito silencioso: corrió reciente, dijo OK, pero no trajo nada.
    if (s.lastStatus === 'success' && s.lastRecordsFound === 0) {
      alerts.push({ kind: 'zero', scraperKey: s.scraperKey, entityType: s.entityType });
    }
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
    case 'error':
      return `Scraper '${a.scraperKey}/${a.entityType}' falló en su último run${a.errorMessage ? `: ${a.errorMessage}` : ''}`;
    case 'zero':
      return `Scraper '${a.scraperKey}/${a.entityType}' terminó OK pero con 0 resultados (posible cambio de la fuente)`;
    case 'missing':
      return `Scraper esperado '${a.scraperKey}' no tiene ninguna ejecución registrada`;
  }
}

/**
 * Contador de fallos CONSECUTIVOS por fuente (auditoría #293).
 *
 * Un blip de red aislado no debe generar alerta: sólo interesa la fuente que
 * falla ciclo tras ciclo. `observe(key, ok)` devuelve `true` exactamente UNA
 * vez por racha, al cruzar el umbral, para no repetir el aviso en cada ciclo.
 * Es puro y por proceso (como MissingLiveTracker): si el proceso reinicia, la
 * cuenta se pierde y el peor caso es un aviso de más, nunca de menos.
 */
export class ScrapeFailureTracker {
  private counts = new Map<string, number>();
  private alerted = new Set<string>();

  constructor(private readonly threshold: number) {
    if (threshold < 1) throw new Error('ScrapeFailureTracker: threshold debe ser >= 1');
  }

  /** Registra el resultado de un ciclo de `key`. `ok` = true si el ciclo fue bien. */
  observe(key: string, ok: boolean): boolean {
    if (ok) {
      this.counts.delete(key);
      this.alerted.delete(key);
      return false;
    }
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    if (n >= this.threshold && !this.alerted.has(key)) {
      this.alerted.add(key);
      return true; // primera vez que la racha cruza el umbral
    }
    return false;
  }

  /** ¿Hay alguna fuente en racha de fallos (ya avisada) ahora mismo? */
  hasFailing(): boolean {
    return this.alerted.size > 0;
  }

  /** Olvida todas las cuentas (p. ej. al recargar estado). */
  reset(): void {
    this.counts.clear();
    this.alerted.clear();
  }
}
