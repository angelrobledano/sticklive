/**
 * Ayudas para las imágenes que pinta `next/og` (Satori).
 *
 * Satori no decodifica WebP: si se le pasa un `data:image/webp` la respuesta
 * falla al hacer stream («failed to pipe response») y la ruta acaba en 502. La
 * API sirve fotos y escudos en WebP por peso, así que las rutas de OG deben
 * pedir explícitamente PNG y, aun así, rechazar cualquier otro formato.
 */

/** Ancho de la foto en la imagen de alineación (se pinta a 76 px). */
export const SATORI_PHOTO_WIDTH = 192;

/** URL de la foto del jugador en PNG, lista para Satori. */
export function playerPhotoUrlForSatori(apiBase: string, playerId: string): string {
  const base = apiBase.replace(/\/+$/, '');
  return `${base}/players/${encodeURIComponent(playerId)}/photo?w=${SATORI_PHOTO_WIDTH}&format=png`;
}

/** ¿Satori puede decodificar este `Content-Type`? Solo PNG y JPEG. */
export function isSatoriRenderableImage(contentType: string | null | undefined): boolean {
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  return type === 'image/png' || type === 'image/jpeg';
}

/** Ancho del escudo en las tarjetas OG (se pinta a 170–260 px). */
export const SATORI_LOGO_WIDTH = 256;

/** URL del escudo en PNG, lista para Satori. */
export function teamLogoUrlForSatori(apiBase: string, teamId: string): string {
  const base = apiBase.replace(/\/+$/, '');
  return `${base}/teams/${encodeURIComponent(teamId)}/logo?w=${SATORI_LOGO_WIDTH}&format=png`;
}

/** Iniciales para el fallback cuando no hay escudo (nunca un círculo vacío). */
export function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '·';
  return words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join('');
}
