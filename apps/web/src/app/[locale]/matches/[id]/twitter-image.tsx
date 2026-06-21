// Twitter/X usa la misma imagen OG dinámica del partido (summary_large_image
// lo activa Next automáticamente al existir este fichero).
export { default, alt, size, contentType } from './opengraph-image';
// La config de segmento (revalidate) no se hereda con el re-export: hay que
// declararla en este fichero para que la imagen de Twitter también refresque.
export const revalidate = 30;
