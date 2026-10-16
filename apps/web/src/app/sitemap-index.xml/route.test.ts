import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET } from './route';
import { SITE_URL } from '@/lib/seo';

/**
 * El índice de sitemaps es lo único que Google ve del sitemap: sin él, las
 * secciones (`/sitemap/<id>.xml`) no se descubren (regresión del 12-oct-2026).
 * El test fija la respuesta del handler y, sobre todo, que índice y sitemap
 * salgan de las MISMAS secciones: si divergieran, el índice apuntaría a
 * ficheros inexistentes.
 */

/** Simula la respuesta de `/meta/sitemap` de la API. */
function stubApi(body: unknown, ok = true): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { 'content-type': 'application/json' },
  })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /sitemap-index.xml', () => {
  it('declara una sección por tipo con datos y responde XML', async () => {
    stubApi({ competitions: ['c1'], teams: ['t1', 't2'], players: [], matches: ['m1'] });

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8');

    const xml = await res.text();
    for (const section of ['core', 'competitions-0', 'teams-0', 'matches-0']) {
      expect(xml).toContain(`<loc>${SITE_URL}/sitemap/${section}.xml</loc>`);
    }
    // players no trae datos: su sección no debe declararse (apuntaría a un 404).
    expect(xml).not.toContain('players-0');
  });

  it('si la API no responde: 503 con Retry-After, nunca un índice degradado (F1-8)', async () => {
    // Antes degradaba a `core` y se cacheaba una hora: Google leía un sitemap de
    // 15 URLs en vez de 15.000 (SEO-07 de docs/AUDITORIA_SEO_2026-10-16.md).
    // Con un 5xx Google reintenta y conserva la última versión buena.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBeTruthy();
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('si la API responde con error: también 503', async () => {
    stubApi({ error: 'Database error' }, false);
    const res = await GET();
    expect(res.status).toBe(503);
  });
});
