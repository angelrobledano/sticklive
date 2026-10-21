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
