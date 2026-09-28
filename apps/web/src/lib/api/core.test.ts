import { describe, it, expect } from 'vitest';
import { ApiError, isApiNotFound } from './core';

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
