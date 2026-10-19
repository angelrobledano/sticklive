import { describe, it, expect } from 'vitest';
import { GET } from './route';
import { SITE_URL } from '@/lib/seo';

describe('GET /llms.txt', () => {
  it('sirve un resumen en texto plano con las entradas principales', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');

    const body = await res.text();
    expect(body).toContain('# Stick Live');
    expect(body).toContain(`${SITE_URL}/es`);
    expect(body).toContain(`${SITE_URL}/es/competitions`);
    expect(body).toContain(`${SITE_URL}/sitemap-index.xml`);
    expect(body).toContain('hreflang');
  });

  it('no anuncia como contenido las zonas privadas', async () => {
    const body = await (await GET()).text();
    expect(body).toContain('/login');
    expect(body).toContain('no forman parte del contenido indexable');
  });
});
