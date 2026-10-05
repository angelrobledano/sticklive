import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError, apiFetch, API_TIMEOUT_MS, isApiNotFound } from './core';

/**
 * #365: `isApiNotFound` no puede confundir un 404 de INFRAESTRUCTURA (proxy/CDN
 * en mantenimiento o con version-skew, que responde HTML) con un recurso
 * inexistente. El API responde sus 404 con cuerpo JSON; si el cuerpo no es JSON,
 * la página debe mostrar su error boundary (con reintento) en vez de notFound().
 */
describe('isApiNotFound (#365)', () => {
  it('404 con cuerpo JSON del API => recurso inexistente', () => {
    expect(isApiNotFound(new ApiError(404, '/teams/abc', '{"error":"Team not found"}'))).toBe(true);
    expect(isApiNotFound(new ApiError(404, '/players/abc', '{ "error": "not found" }'))).toBe(true);
  });

  it('404 de infraestructura (HTML de proxy/CDN) => NO recurso inexistente', () => {
    expect(isApiNotFound(new ApiError(404, '/teams/abc', '<!DOCTYPE html><title>404</title>'))).toBe(false);
    expect(isApiNotFound(new ApiError(404, '/teams/abc', 'Service Unavailable'))).toBe(false);
  });

  it('otros estados => false, incluido un 503 de mantenimiento', () => {
    expect(isApiNotFound(new ApiError(500, '/teams/abc', '{"error":"boom"}'))).toBe(false);
    expect(isApiNotFound(new ApiError(503, '/teams/abc', '<html>maintenance</html>'))).toBe(false);
  });

  it('fallback serializado: solo el formato JSON exacto del API', () => {
    // Mensaje de ApiError serializado (pierde la clase al cruzar fronteras RSC).
    expect(isApiNotFound(new Error('API 404 - /teams/abc: {"error":"Team not found"}'))).toBe(true);
    // Un 404 de infraestructura serializado sigue sin llevar cuerpo JSON.
    expect(isApiNotFound(new Error('API 404 - /teams/abc: <!DOCTYPE html>'))).toBe(false);
    // Errores genéricos que empiezan por el prefijo no deben colar.
    expect(isApiNotFound(new Error('API 404'))).toBe(false);
    expect(isApiNotFound(new Error('boom'))).toBe(false);
  });

  it('valores que no son Error => false', () => {
    expect(isApiNotFound('API 404 - /teams/abc')).toBe(false);
    expect(isApiNotFound(null)).toBe(false);
    expect(isApiNotFound(undefined)).toBe(false);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Incidente 2026-10-05: el cliente web llamaba a la API sin timeout. Si la API
 * se colgaba (no caía), el SSR de Next se quedaba esperando y podía tumbar
 * también el healthcheck de `web`. `apiFetch` debe abortar y rechazar.
 */
describe('apiFetch timeout', () => {
  /** fetch que solo resuelve/rechaza cuando aborta el signal de la petición. */
  const hangingFetch = () => vi.fn((_url: string, init?: RequestInit) =>
    new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      );
    }),
  );

  it('aborta y rechaza cuando la API no responde a tiempo', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    await expect(apiFetch('/health', undefined, 20)).rejects.toThrow();
  });

  it('respeta un signal del llamante combinándolo con el timeout', async () => {
    const ctrl = new AbortController();
    vi.stubGlobal('fetch', hangingFetch());

    const pending = apiFetch('/matches/1', { signal: ctrl.signal }, 5000);
    ctrl.abort();

    await expect(pending).rejects.toThrow();
  });

  it('expone un presupuesto por defecto razonable', () => {
    expect(API_TIMEOUT_MS).toBeGreaterThan(0);
    expect(API_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });
});
