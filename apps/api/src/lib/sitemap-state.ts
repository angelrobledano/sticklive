/**
 * Detección de caídas del sitemap (F1-8 de la auditoría SEO).
 *
 * `/meta/sitemap` guarda el total de cada generación en `sitemap_state`. Si el
 * nuevo cae más del 20 % respecto al anterior, se manda un evento a Sentry:
 * es la señal de que un ETL defectuoso está retirando fichas elegibles, antes
 * de que Google lo interprete como una retirada masiva.
 */

/** Caída a partir de la cual se avisa: más del 20 %. */
export const SITEMAP_DROP_THRESHOLD = 0.2;

/** Porcentaje de caída (positivo si baja, negativo si sube); null sin base. */
export function sitemapDropPct(
  previous: number | null | undefined,
  current: number,
): number | null {
  if (previous == null || previous <= 0) return null;
  return Math.round((1 - current / previous) * 100);
}

/** ¿Hay que avisar? Solo con una base válida y una caída estrictamente > 20 %. */
export function shouldAlertSitemapDrop(
  previous: number | null | undefined,
  current: number,
): boolean {
  if (previous == null || previous <= 0) return false;
  return current < previous * (1 - SITEMAP_DROP_THRESHOLD);
}
