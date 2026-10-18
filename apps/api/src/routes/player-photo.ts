import { Hono } from 'hono';
import { db } from '@sports/db';
import { setBounded } from '../lib/bounded-cache.js';
import { isUuid } from '../lib/uuid.js';
import { lookupImageUrl } from '../lib/image-url.js';
import {
  imageResponse,
  renderResizedImage,
  resolveImageFormat,
  resolveImageWidth,
} from '../lib/image.js';

/**
 * GET /players/:id/photo — foto del jugador servida desde NUESTRO dominio.
 *
 * Las fotos viven en el CDN de sidgad (cross-origin). Sirviéndolas vía proxy:
 *   1. html2canvas puede capturarlas al compartir la alineación (un <img>
 *      cross-origin sin CORS sale en blanco / "taintea" el canvas).
 *   2. Se evita el hotlink (proxy con Referer).
 *
 * #335 (perf P0): la ficha original puede pesar >1 MB y la web la pinta a
 * 32–80 px. Se redimensiona/reencoda a WebP (ancho con `?w=`, acotado a
 * presets) y se sirve con `Cache-Control` inmutable.
 *
 * `?format=png` existe para `next/og` (Satori), que no decodifica WebP: la
 * imagen de la alineación se quedaba en 502 en cuanto un titular tenía foto.
 */
export const playerPhotoRouter = new Hono();

// Micro-caché en proceso de las imágenes YA transformadas (clave `id:w`).
const photoCache = new Map<string, Buffer>();
const PHOTO_CACHE_MAX = 512;

playerPhotoRouter.get('/:id/photo', async (c) => {
  const id = c.req.param('id');
  // Un id no-UUID haría fallar el cast a uuid de Postgres → 500 (#275/#321).
  if (!isUuid(id)) return c.notFound();

  const width = resolveImageWidth(c.req.query('w'));
  const format = resolveImageFormat(c.req.query('format'));
  const key = `${id}:${width}:${format}`;
  const cached = photoCache.get(key);
  if (cached) return imageResponse(cached, format === 'png' ? 'image/png' : 'image/webp');

  const url = await lookupImageUrl(async () => {
    const r = await db.query<{ photo_url: string | null }>(
      `SELECT photo_url FROM players WHERE id = $1`, [id]
    );
    return r.rows[0]?.photo_url ?? null;
  });
  if (!url) return c.notFound();

  try {
    const res = await fetch(url, {
      headers: { Referer: 'https://www.hockeypatines.fep.es/' },
      // #333: timeout para no colgar la petición si el CDN no responde.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return c.notFound();
    const source = Buffer.from(await res.arrayBuffer());

    try {
      const out = await renderResizedImage(source, width, format);
      setBounded(photoCache, key, out, PHOTO_CACHE_MAX);
      return imageResponse(out, format === 'png' ? 'image/png' : 'image/webp');
    } catch {
      // sharp no pudo decodificar: degradar al original antes que al 404.
      return imageResponse(source, res.headers.get('content-type') ?? 'image/jpeg');
    }
  } catch {
    return c.notFound();
  }
});
