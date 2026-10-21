import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch, resolveDefaultApiUrl } from './client';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveDefaultApiUrl', () => {
  it('resuelve 10.0.2.2 en Android en modo desarrollo (emulador host)', () => {
    expect(resolveDefaultApiUrl('android', true)).toBe('http://10.0.2.2:3000');
  });

  it('resuelve localhost en iOS en modo desarrollo (simulador host)', () => {
    expect(resolveDefaultApiUrl('ios', true)).toBe('http://localhost:3000');
  });

  it('resuelve localhost para otras plataformas en modo desarrollo (web, etc.)', () => {
    expect(resolveDefaultApiUrl('web', true)).toBe('http://localhost:3000');
  });

  it('resuelve la API de producción en modo no-desarrollo (!isDev) para cualquier plataforma', () => {
    expect(resolveDefaultApiUrl('android', false)).toBe('https://sticklive.eu/api');
    expect(resolveDefaultApiUrl('ios', false)).toBe('https://sticklive.eu/api');
    expect(resolveDefaultApiUrl('web', false)).toBe('https://sticklive.eu/api');
  });
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

  it('propaga AbortError tal cual (no lo convierte en ApiError)', async () => {
    const abortErr = new DOMException('aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn(async () => { throw abortErr; }));
    await expect(apiFetch('/matches')).rejects.toBe(abortErr);
  });

  it('POST serializa el body con Content-Type json', async () => {
    const fetchMock = vi.fn(async () => ok({ created: true }));
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/auth/favorites/merge', { method: 'POST', token: 'abc', body: { teams: ['t1'] } });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/favorites/merge'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ teams: ['t1'] }),
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });
});
