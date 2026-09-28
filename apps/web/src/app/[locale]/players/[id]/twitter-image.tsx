// Twitter/X usa la misma imagen OG dinámica del jugador (summary_large_image).
export { default, alt, size, contentType } from './opengraph-image';
// La config de segmento (revalidate) no se hereda con el re-export.
export const revalidate = 120;
