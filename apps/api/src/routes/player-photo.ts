import { Hono } from 'hono';
import { db } from '@sports/db';

/**
 * GET /players/:id/photo — foto del jugador servida desde NUESTRO dominio.
 *
 * Las fotos viven en el CDN de sidgad (cross-origin). Sirviéndolas vía proxy:
 *   1. html2canvas puede capturarlas al compartir la alineación (un <img>
 *      cross-origin sin CORS sale en blanco / "taintea" el canvas).
 *   2. Se evita el hotlink (proxy con Referer).
 */
export const playerPhotoRouter = new Hono();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE = 'public, max-age=86400';

playerPhotoRouter.get('/:id/photo', async (c) => {
  const id = c.req.param('id');
  if (!UUID.test(id)) return c.notFound();

  const r = await db.query<{ photo_url: string | null }>(
    `SELECT photo_url FROM players WHERE id = $1`, [id]
  );
  const url = r.rows[0]?.photo_url;
  if (!url) return c.notFound();

  try {
    const res = await fetch(url, {
      headers: { Referer: 'https://www.hockeypatines.fep.es/' },
      // #333: timeout para no colgar la petición si el CDN no responde.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return c.notFound();
    const buf = Buffer.from(await res.arrayBuffer());
    return new Response(buf, {
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'image/jpeg', 'Cache-Control': CACHE },
    });
  } catch {
    return c.notFound();
  }
});
