import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchPremiumStatus, shouldShowAds } from './queries';

afterEach(() => {
  vi.unstubAllGlobals();
});

// El guard de ads es la regla de dinero: premium SIEMPRE gana; sin
// consentimiento UMP no hay ads; sin unit id no hay ads (fail-closed).
describe('shouldShowAds', () => {
  it('premium gana siempre, haya o no consentimiento', () => {
    expect(shouldShowAds({ premium: true, consentGranted: true, unitId: 'u' })).toBe(false);
    expect(shouldShowAds({ premium: true, consentGranted: false, unitId: 'u' })).toBe(false);
  });

  it('sin premium: ads solo con consentimiento UMP Y unit id configurado', () => {
    expect(shouldShowAds({ premium: false, consentGranted: true, unitId: 'u' })).toBe(true);
    expect(shouldShowAds({ premium: false, consentGranted: false, unitId: 'u' })).toBe(false);
    expect(shouldShowAds({ premium: false, consentGranted: true, unitId: '' })).toBe(false);
  });

  it('premium desconocido (cargando/error) ⇒ fail-closed, nunca ads', () => {
    expect(shouldShowAds({ premium: undefined, consentGranted: true, unitId: 'u' })).toBe(false);
  });

  it('premium desconocido sin consentimiento ⇒ false', () => {
    expect(shouldShowAds({ premium: undefined, consentGranted: false, unitId: 'u' })).toBe(false);
  });
});

describe('fetchPremiumStatus', () => {
  it('GET /payments/status con Bearer y mapea el DTO', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ premium: true, premiumUntil: null, premiumLifetime: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const status = await fetchPremiumStatus('tok');

    expect(status).toEqual({ premium: true, premiumUntil: null, premiumLifetime: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/payments/status');
    expect((init as { headers: Record<string, string> }).headers['Authorization']).toBe(
      'Bearer tok'
    );
  });
});
