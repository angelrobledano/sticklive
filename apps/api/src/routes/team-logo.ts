import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { db } from '@sports/db';
import { setBounded } from '../lib/bounded-cache.js';
import { isUuid } from '../lib/uuid.js';
import { lookupImageUrl } from '../lib/image-url.js';
import {
  imageResponse,
  renderNormalizedLogo,
  resolveImageFormat,
  resolveImageWidth,
} from '../lib/image.js';

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
 * Un fallo o lentitud de la BD al resolver `logo_url` NO debe romper el escudo:
 * `lookupImageUrl` lo convierte en el mismo 404 (fallback) en vez de un 500
 * (incidente 2026-10-05: timeouts de conexión durante un reinicio de la API).
 *
 * `teams.logo_url` queda como la fuente de verdad; el fichero local es solo una
 * caché en disco.
 *
 * #335 (perf P0): el original pesa hasta 2,4 MB y la web lo pinta a 20–80 px.
 * Ahora se redimensiona y reencoda a WebP (ancho elegido con `?w=`, acotado a
 * presets) y se sirve con `Cache-Control` inmutable.
 *
 * #385: el proxy del CDN servía escudos crudos (con transparencia y márgenes
 * irregulares). Ahora TODAS las ramas pasan por `renderNormalizedLogo`, que
 * reproduce la normalización del ETL (recorte + fondo blanco + margen uniforme),
 * para que un escudo local y uno de CDN se vean igual sobre fondo oscuro.
 */
export const teamLogoRouter = new Hono();

const ESCUDOS_DIR = process.env['ESCUDOS_DIR'] ?? '/app/apps/web/public/escudos';

// Micro-caché en proceso de las imágenes YA transformadas (clave `id:w`). Los
// anchos posibles son un conjunto finito, así que la cardinalidad queda acotada.
const logoCache = new Map<string, Buffer>();
const LOGO_CACHE_MAX = 512;

teamLogoRouter.get('/:id/logo', async (c) => {
  const id = c.req.param('id');
  // Un id no-UUID haría fallar el cast a uuid de Postgres en el proxy → 500 (#275/#321).
  if (!isUuid(id)) return c.notFound();

  const width = resolveImageWidth(c.req.query('w'));
  // `?format=png` para `next/og` (Satori), que no decodifica WebP. El resto
  // sigue recibiendo WebP, que pesa menos.
  const format = resolveImageFormat(c.req.query('format'));
  const key = `${id}:${width}:${format}`;
  const contentType = format === 'png' ? 'image/png' : 'image/webp';
  const cached = logoCache.get(key);
  if (cached) return imageResponse(cached, contentType);

  // 1) Fichero local del volumen.
  let source: Buffer | null = null;
  let sourceType = 'image/png';
  try {
    source = await readFile(path.join(ESCUDOS_DIR, `${id}.png`));
  } catch { /* sin fichero → probamos el CDN */ }

  // 2) Proxy del CDN sidgad (con Referer).
  if (!source) {
    // `lookupImageUrl` acota y captura el fallo de la BD: si Postgres no
    // responde, esto es un 404 (fallback del cliente), no un 500 colgado.
    const url = await lookupImageUrl(async () => {
      const r = await db.query<{ logo_url: string | null }>(
        `SELECT logo_url FROM teams WHERE id = $1`, [id]
      );
      return r.rows[0]?.logo_url ?? null;
    });
    if (!url) return c.notFound();
    try {
      const res = await fetch(url, {
        headers: { Referer: 'https://www.hockeypatines.fep.es/' },
        // #333: sin timeout, un CDN lento bloquea el request de la API. 5 s basta
        // para un escudo; si tarda más, preferimos el 404 (fallback del cliente).
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return c.notFound();
      source = Buffer.from(await res.arrayBuffer());
      sourceType = res.headers.get('content-type') ?? sourceType;
    } catch {
      return c.notFound();
    }
  }

  try {
    const out = await renderNormalizedLogo(source, width, format);
    setBounded(logoCache, key, out, LOGO_CACHE_MAX);
    return imageResponse(out, contentType);
  } catch {
    // sharp no pudo decodificar (formato exótico): mejor servir el original que
    // romper el escudo. El cliente sintetiza su fallback si tampoco carga.
    return imageResponse(source, sourceType);
  }
});
