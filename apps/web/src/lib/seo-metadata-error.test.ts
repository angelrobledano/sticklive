import { describe, it, expect } from 'vitest';
import { metadataOnError } from './seo';
import { ApiError } from './api/core';

/**
 * SEO-06 / F1-10 (`docs/AUDITORIA_SEO_2026-10-16.md`): si la API fallaba al
 * generar la metadata de una ficha, el `catch` devolvía solo `alternates` y la
 * página heredaba el título y la descripción de la home (duplicado indexable).
 *
 * - 404 real de la API → la ficha no existe: metadata mínima y `noindex` (la
 *   página responde 404 con `notFound()`).
 * - Cualquier otro fallo (caída, timeout, 5xx) → se propaga: la respuesta es
 *   5xx, Google reintenta y no desindexa una ficha buena por un fallo temporal.
 */
describe('metadataOnError', () => {
  const alternates = { canonical: 'https://sticklive.eu/es/teams/t1' };

  it('404 de la API: noindex y sin título heredado', () => {
    const meta = metadataOnError(new ApiError(404, '/teams/t1', '{"error":"Team not found"}'), alternates);
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toBe(alternates);
    expect(meta.title).toBeUndefined();
  });

  it('caída de la API: se propaga el error (5xx, no 200 con metadata de la home)', () => {
    const err = new ApiError(503, '/teams/t1', '<html>maintenance</html>');
    expect(() => metadataOnError(err, alternates)).toThrow(err);
    expect(() => metadataOnError(new Error('timeout'), alternates)).toThrow('timeout');
  });
});
