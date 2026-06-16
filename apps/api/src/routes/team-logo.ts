import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { db } from '@sports/db';

/**
 * GET /teams/:id/logo — escudo del equipo (auditoría A3: una sola fuente).
 *
 * Orden de resolución:
 *   1. Fichero del volumen compartido (lo rellena `download-logos`). Se lee en
 *      cada request, así que un escudo nuevo aparece SIN reiniciar `web`
 *      (a diferencia de servirlo desde public/ de Next).
 *   2. Si no hay fichero, PROXY del CDN sidgad con Referer (evita el bloqueo de
 *      hotlink que tendría el navegador al cargar sidgad directamente).
 *   3. Si nada, 404 → el cliente cae a su escudo genérico / iniciales.
 *
 * `teams.logo_url` queda como la fuente de verdad; el fichero local es solo una
 * caché en disco.
 */
export const teamLogoRouter = new Hono();

const ESCUDOS_DIR = process.env['ESCUDOS_DIR'] ?? '/app/apps/web/public/escudos';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE = 'public, max-age=86400';

teamLogoRouter.get('/:id/logo', async (c) => {
  const id = c.req.param('id');
  if (!UUID.test(id)) return c.notFound();

  // 1) Fichero local del volumen.
  try {
    const buf = await readFile(path.join(ESCUDOS_DIR, `${id}.png`));
    return new Response(buf, { headers: { 'Content-Type': 'image/png', 'Cache-Control': CACHE } });
  } catch { /* sin fichero → probamos el CDN */ }

  // 2) Proxy del CDN sidgad (con Referer).
  const r = await db.query<{ logo_url: string | null }>(
    `SELECT logo_url FROM teams WHERE id = $1`, [id]
  );
  const url = r.rows[0]?.logo_url;
  if (!url) return c.notFound();
  try {
    const res = await fetch(url, { headers: { Referer: 'https://www.hockeypatines.fep.es/' } });
    if (!res.ok) return c.notFound();
    const buf = Buffer.from(await res.arrayBuffer());
    return new Response(buf, {
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'image/png', 'Cache-Control': CACHE },
    });
  } catch {
    return c.notFound();
  }
});
