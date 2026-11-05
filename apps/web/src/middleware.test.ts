import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

/**
 * El fallback de idioma es una decisión de producto: España es el mercado
 * principal y Googlebot no envía `Accept-Language`. Sin cookie ni cabecera,
 * una URL sin prefijo debe acabar en `/es`, no en `/en`.
 */
describe('middleware de idioma', () => {
  it('sin cookie ni Accept-Language redirige a /es (Googlebot)', () => {
    const res = middleware(new NextRequest('https://sticklive.eu/teams/t1'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://sticklive.eu/es/teams/t1');
  });

  it('respeta Accept-Language cuando no hay cookie', () => {
    const res = middleware(new NextRequest('https://sticklive.eu/teams/t1', {
      headers: { 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8' },
    }));

    expect(res.headers.get('location')).toBe('https://sticklive.eu/pt/teams/t1');
  });

  it('respeta Accept-Language para catalán (ca)', () => {
    const res = middleware(new NextRequest('https://sticklive.eu/teams/t1', {
      headers: { 'accept-language': 'ca-ES,ca;q=0.9,es;q=0.8' },
    }));

    expect(res.headers.get('location')).toBe('https://sticklive.eu/ca/teams/t1');
  });

  it('la cookie manda sobre Accept-Language', () => {
    const res = middleware(new NextRequest('https://sticklive.eu/teams/t1', {
      headers: { cookie: 'sticklive_locale=fr', 'accept-language': 'en-US' },
    }));

    expect(res.headers.get('location')).toBe('https://sticklive.eu/fr/teams/t1');
  });

  it('una URL ya prefijada sin preferencia (Googlebot) no se redirige', () => {
    const res = middleware(new NextRequest('https://sticklive.eu/en/teams/t1'));

    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});

/**
 * Idioma del dispositivo también en URLs con prefijo: un enlace compartido
 * (/es/...) se abre en el idioma del que lo recibe, sin avisos. La elección
 * manual (cookie) manda. Los bots y previsualizadores no se redirigen: cada
 * URL prefijada es la canónica de su idioma (hreflang).
 */
describe('middleware: URL prefijada en otro idioma', () => {
  const CHROME = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
  const req = (url: string, headers: Record<string, string>) =>
    new NextRequest(url, { headers: { 'user-agent': CHROME, ...headers } });

  it('dispositivo en inglés abre /es/... → /en/... (conserva ruta y query)', () => {
    const res = middleware(req('https://sticklive.eu/es/competitions/c1?tab=fixtures', { 'accept-language': 'en-GB,en;q=0.9' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://sticklive.eu/en/competitions/c1?tab=fixtures');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('mismo idioma: no se redirige', () => {
    const res = middleware(req('https://sticklive.eu/es/teams/t1', { 'accept-language': 'es-ES,es;q=0.9' }));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('la elección manual (cookie) manda sobre el dispositivo', () => {
    const res = middleware(req('https://sticklive.eu/en/teams/t1', { cookie: 'sticklive_locale=es', 'accept-language': 'en-US' }));
    expect(res.headers.get('location')).toBe('https://sticklive.eu/es/teams/t1');
  });

  it('la cookie coincide con la URL: se respeta aunque el dispositivo diga otra cosa', () => {
    const res = middleware(req('https://sticklive.eu/es/teams/t1', { cookie: 'sticklive_locale=es', 'accept-language': 'en-US' }));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('dispositivo en un idioma no soportado (alemán sin alternativa): no se redirige', () => {
    const res = middleware(req('https://sticklive.eu/es/teams/t1', { 'accept-language': 'de-DE,de;q=0.9' }));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('bots y previsualizadores de enlaces: nunca', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'WhatsApp/2.23.20.0',
      'facebookexternalhit/1.1',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
    ]) {
      const res = middleware(new NextRequest('https://sticklive.eu/es/teams/t1', {
        headers: { 'user-agent': ua, 'accept-language': 'en-US' },
      }));
      expect(res.headers.get('x-middleware-next'), ua).toBe('1');
    }
  });

  it('peticiones internas de navegación (RSC/prefetch): no se redirigen', () => {
    const res = middleware(req('https://sticklive.eu/es/teams/t1', { 'accept-language': 'en-US', rsc: '1' }));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});
