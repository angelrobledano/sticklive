import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './client';

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('hace GET a la API base y parsea JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ ok: true })));
    const res = await apiFetch<{ ok: boolean }>('/health');
    expect(res).toEqual({ ok: true });
  });

  it('envía Authorization Bearer si hay token', async () => {
    const fetchMock = vi.fn(async () => ok({ authenticated: true }));
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/auth/me', { token: 'abc' });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/me'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer abc' }) }),
    );
  });

  it('lanza ApiError con el código del envelope de error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })));
    await expect(apiFetch('/auth/me')).rejects.toMatchObject({
      name: 'ApiError', status: 401, code: 'unauthorized',
    } satisfies Partial<ApiError>);
  });

  it('lanza ApiError code=network si fetch rechaza', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Network request failed'); }));
    await expect(apiFetch('/competitions')).rejects.toMatchObject({ code: 'network' });
  });
});
