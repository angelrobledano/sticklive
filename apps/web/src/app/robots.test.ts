import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import robots from './robots';

/**
 * Guardia anti-deriva del sitemap (regresión GSC del 12-oct-2026).
 *
 * `robots.ts` anunciaba `Sitemap: /sitemap.xml`, pero con `generateSitemaps()`
 * Next no sirve esa ruta: la mapea a `/sitemap/[__metadata_id__]` y deja
 * `/sitemap.xml` en 404. Google no leyó ninguna sección y las 14.050 URLs del
 * sitemap eran invisibles (solo conocía lo que alcanzaba por enlaces).
 *
 * Este test ata la URL anunciada al fichero de ruta que la sirve: si alguien
 * renombra la ruta del índice o vuelve a anunciar `/sitemap.xml`, falla aquí y
 * no en producción.
 */

const APP_DIR = dirname(fileURLToPath(import.meta.url)); // apps/web/src/app

describe('robots.txt → sitemap', () => {
  it('anuncia una ruta de sitemap que existe de verdad', () => {
    const pathname = new URL(String(robots().sitemap)).pathname;
    const routeFile = resolve(APP_DIR, `.${pathname}`, 'route.ts');
    expect(existsSync(routeFile), `falta la ruta que sirve ${pathname} (${routeFile})`).toBe(true);
  });

  it('no anuncia /sitemap.xml: con generateSitemaps Next no sirve esa ruta', () => {
    expect(new URL(String(robots().sitemap)).pathname).not.toBe('/sitemap.xml');
  });

  it('deja rastrear los escudos y mantiene el resto del API bloqueado', () => {
    const rule = [robots().rules].flat()[0]!;
    expect(rule.allow).toContain('/api/teams/*/logo');
    expect(rule.disallow).toContain('/api/');
  });
});
