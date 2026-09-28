/**
 * Utilidades de imagen de la API (#335, perf P0).
 *
 * El CDN entrega escudos y fotos a resolución original: hasta 2,4 MB por logo
 * pintado a 20–80 px. Aquí se redimensiona y reencoda a WebP antes de responder.
 *
 * El ancho se acota a un conjunto FINITO de presets. Es la pieza clave: si el
 * cliente pudiera pedir cualquier `?w=`, cada valor generaría una transformación
 * distinta (CPU) y una entrada de caché distinta (memoria/disco). Con presets,
 * ambas cosas quedan acotadas.
 */
import sharp from 'sharp';

/** Anchos (px) soportados. En la web se pintan a 20–80 px (hasta 2×). */
export const IMAGE_WIDTH_PRESETS = [32, 64, 96, 144, 192, 256, 512] as const;

/**
 * Ancho por defecto si no se pide `?w=` (o es inválido).
 *
 * No es "pequeño" del todo a propósito: hay consumidores fuera de la web que
 * piden la imagen SIN `?w=` y la pintan a 260 px (tarjetas OG de equipo y
 * jugador). 256 evita que esas tarjetas se vean borrosas y, aun así, reduce el
 * peso servido de ~1,4 MB a decenas de KB. La web sí pide anchos pequeños.
 */
export const DEFAULT_IMAGE_WIDTH = 256;

/** Cabecera de contenido inmutable: el ancho va en la URL (`?w=`). */
export const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Resuelve el ancho pedido por `?w=` hacia un preset.
 *
 * - Vacío / inválido / <= 0 → DEFAULT_IMAGE_WIDTH.
 * - Se redondea HACIA ARRIBA al preset más pequeño que cubre lo pedido
 *   (nunca se sirve menos resolución de la solicitada).
 * - Por encima del mayor preset → el mayor preset.
 */
export function resolveImageWidth(raw: string | null | undefined): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_IMAGE_WIDTH;

  const preset = IMAGE_WIDTH_PRESETS.find((value) => value >= parsed);
  // El array nunca está vacío; el `!` satisface `noUncheckedIndexedAccess`.
  return preset ?? IMAGE_WIDTH_PRESETS[IMAGE_WIDTH_PRESETS.length - 1]!;
}

/**
 * Redimensiona por ancho y reencoda a WebP.
 *
 * - `withoutEnlargement` evita ampliar originales pequeños.
 * - `rotate()` respeta la orientación EXIF de las fotos de móvil.
 * - WebP conserva el alfa de los escudos transparentes.
 */
export async function renderResizedImage(input: Buffer, width: number): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}

/** Respuesta de imagen con caché inmutable. */
export function imageResponse(buf: Buffer, contentType = 'image/webp'): Response {
  return new Response(buf, {
    headers: { 'Content-Type': contentType, 'Cache-Control': IMAGE_CACHE_CONTROL },
  });
}
