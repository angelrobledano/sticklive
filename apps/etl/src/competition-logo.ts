/**
 * URL del logo de competición en el CDN del portal. La fuente publica el
 * fichero en `a.idc_master[logo]`; `default.png` es el placeholder genérico.
 */
export function competitionLogoUrl(portal: string, logo: string | null | undefined): string | null {
  const file = (logo ?? '').trim();
  if (!file || file === 'default.png') return null;
  return `https://sidgad.cloud/${portal}/images/logos_competiciones/${file.replace(/^\/+/, '')}`;
}

/**
 * idc del catálogo desde `competitions.source_ref`: `fecapa_competition_4774` → `4774`.
 * Antes solo se quitaba `fep_`/`wse_` y las competiciones de las autonómicas
 * no casaban con su catálogo (se quedaban sin logo y salía la bandera).
 */
export function idcFromSourceRef(sourceRef: string | null | undefined): string {
  return (sourceRef ?? '').replace(/^[a-z]+_competition_/, '');
}
