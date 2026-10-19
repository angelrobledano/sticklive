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

  it('la cookie manda sobre Accept-Language', () => {
    const res = middleware(new NextRequest('https://sticklive.eu/teams/t1', {
      headers: { cookie: 'sticklive_locale=fr', 'accept-language': 'en-US' },
    }));

    expect(res.headers.get('location')).toBe('https://sticklive.eu/fr/teams/t1');
  });

  it('una URL ya prefijada no se redirige', () => {
    const res = middleware(new NextRequest('https://sticklive.eu/en/teams/t1'));

    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});
