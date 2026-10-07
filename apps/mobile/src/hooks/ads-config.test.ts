import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchAdsConfig, qk } from './queries';

afterEach(() => {
  vi.unstubAllGlobals();
});

// GET /ads/config es PÚBLICO: gobierna los formatos de ads para cualquier
// usuario (con o sin sesión, antes de saber quién es). La petición NO debe
// llevar Authorization (un token anónimo ausente no debe colarse por error).
describe('fetchAdsConfig', () => {
  it('GET /ads/config sin Authorization y mapea el DTO', async () => {
    const body = {
      appOpen: { enabled: false, minIntervalHours: 4 },
      interstitial: { enabled: false, minIntervalMinutes: 20, maxPerHour: 2 },
      rewarded: { enabled: false, adfreeMinutes: 30 },
      nativeFeed: { enabled: false, everyNItems: 8 },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(body),
    });
    vi.stubGlobal('fetch', fetchMock);

    const cfg = await fetchAdsConfig();

    expect(cfg).toEqual(body);
    expect(qk.adsConfig).toEqual(['adsConfig']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/ads/config');
    expect((init as { headers: Record<string, string> }).headers['Authorization']).toBeUndefined();
  });
});
