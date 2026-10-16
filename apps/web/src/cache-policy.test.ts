import { describe, it, expect, vi } from 'vitest';

// `next.config.mjs` no puede ejecutarse entero en test (envuelve Sentry): lo
// neutralizamos para probar solo la decisión pura de caché por ruta (#351).
vi.mock('@sentry/nextjs', () => ({ withSentryConfig: (config: unknown) => config }));

import { htmlCacheControlForPath, HTML_LIMITED_BOTS } from '../next.config.mjs';

const COMPETITION_DETAIL = 'public, s-maxage=30, stale-while-revalidate=300';

describe('htmlCacheControlForPath (#351)', () => {
  it('cachea el HTML de la ficha de competición en todos los idiomas', () => {
    expect(
      htmlCacheControlForPath('/es/competitions/0073f9aa-1111-4222-8333-444455556666'),
    ).toBe(COMPETITION_DETAIL);
    expect(htmlCacheControlForPath('/en/competitions/9bc7cb2c-9c9c-4bd1-9474-b86da60d4be5')).toBe(
      COMPETITION_DETAIL,
    );
  });

  it('no cachea el listado, rutas anidadas ni locales no soportados', () => {
    expect(htmlCacheControlForPath('/es/competitions')).toBeNull();
    expect(htmlCacheControlForPath('/es/competitions/x/opengraph-image')).toBeNull();
    expect(htmlCacheControlForPath('/xx/competitions/x')).toBeNull();
    expect(htmlCacheControlForPath('/es/matches/x')).toBeNull();
    expect(htmlCacheControlForPath('/es')).toBeNull();
    expect(htmlCacheControlForPath('/')).toBeNull();
  });
});

/**
 * F1-0 (SEO-02): las fichas lentas servían `<title>`, canonical y hreflang
 * DESPUÉS de `</head>` (metadata en streaming) y Google, que solo lee el
 * canonical del `<head>`, las reportaba como «Duplicada: el usuario no ha
 * indicado ninguna versión canónica» (32 URLs, todas `/en/…`). La lista por
 * defecto de Next no incluye `Googlebot`: si alguien la sustituye sin él, el
 * problema vuelve.
 */
describe('HTML_LIMITED_BOTS (F1-0)', () => {
  it('incluye Googlebot, que NO viene en la lista por defecto de Next', () => {
    expect(HTML_LIMITED_BOTS.test('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(HTML_LIMITED_BOTS.test('Googlebot-Image/1.0')).toBe(true);
    expect(HTML_LIMITED_BOTS.test('Mozilla/5.0 (Linux; Android 6.0.1) AppleWebKit/537.36 (compatible; Google-InspectionTool/1.0)')).toBe(true);
  });

  it('mantiene los rastreadores de la lista por defecto', () => {
    for (const ua of [
      'Mediapartners-Google',
      'AdsBot-Google-Mobile',
      'Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'Twitterbot/1.0',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'WhatsApp/2.19.81 A',
      'facebookexternalhit/1.1',
    ]) {
      expect(HTML_LIMITED_BOTS.test(ua), ua).toBe(true);
    }
  });

  it('NO bloquea a las personas: un navegador normal sigue con streaming', () => {
    expect(HTML_LIMITED_BOTS.test('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36')).toBe(false);
    expect(HTML_LIMITED_BOTS.test('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe(false);
  });
});
