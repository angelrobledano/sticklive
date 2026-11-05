import { describe, expect, it } from 'vitest';
import { GET as getAasa } from './apple-app-site-association/route';
import { GET as getAssetLinks } from './assetlinks.json/route';

describe('Well-Known Route Handlers', () => {
  it('GET /.well-known/apple-app-site-association devuelve estructura AASA válida', async () => {
    const res = getAasa();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const json = await res.json();
    expect(json.applinks).toBeDefined();
    expect(json.applinks.details[0].appID).toContain('eu.sticklive.app');
    expect(json.applinks.details[0].paths).toContain('/login*');
    expect(json.applinks.details[0].paths).toContain('/match/*');
  });

  it('AASA cubre las URLs reales de la web, con y sin locale, y excluye admin', async () => {
    const json = await getAasa().json();
    const components: { '/': string; exclude?: boolean; '?'?: Record<string, string> }[] =
      json.applinks.details[0].components;
    const included = components.filter((c) => !c.exclude).map((c) => c['/']);
    for (const p of ['/matches/*', '/teams/*', '/players/*', '/competitions*', '/favorites', '/search*']) {
      expect(included).toContain(p);
      expect(included).toContain(`/*${p}`);
    }
    for (const p of ['/match/*', '/competition/*', '/team/*']) expect(included).toContain(p);
    // La primera regla que encaja gana: admin va antes que cualquier inclusión
    expect(components[0]).toMatchObject({ '/': '/*/admin*', exclude: true });
    expect(components[1]).toMatchObject({ '/': '/admin*', exclude: true });
    const login = components.find((c) => c['/'] === '/login*');
    expect(login?.['?']).toEqual({ token: '?*' });
  });

  it('GET /.well-known/assetlinks.json devuelve estructura Android Asset Links válida', async () => {
    const res = getAssetLinks();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json[0].target.package_name).toBe('eu.sticklive.app');
    expect(json[0].relation).toContain('delegate_permission/common.handle_all_urls');
  });
});
