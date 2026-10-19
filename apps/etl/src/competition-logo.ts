/**
 * URL del logo de competición en el CDN del portal. La fuente publica el
 * fichero en `a.idc_master[logo]`; `default.png` es el placeholder genérico.
 */
export function competitionLogoUrl(portal: string, logo: string | null | undefined): string | null {
  const file = (logo ?? '').trim();
  if (!file || file === 'default.png') return null;
  return `https://sidgad.cloud/${portal}/images/logos_competiciones/${file.replace(/^\/+/, '')}`;
}
