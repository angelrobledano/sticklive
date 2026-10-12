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

  it('si la API no responde degrada a core en vez de romper el índice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    const res = await GET();
    const xml = await res.text();
    expect(res.status).toBe(200);
    expect((xml.match(/<sitemap>/g) ?? []).length).toBe(1);
    expect(xml).toContain(`<loc>${SITE_URL}/sitemap/core.xml</loc>`);
  });
});
