import { describe, it, expect } from 'vitest';
import { socialMeta, socialImageVersion, socialImageUrl, SITE_URL } from './seo';

/**
 * #273: al compartir una ficha de partido en X/Twitter, la tarjeta debe usar
 * el título/descripción del partido (no los genéricos de portada).
 * #274: la URL de la imagen social lleva un token de versión dependiente del
 * estado/marcador para que los scrapers pidan una URL nueva en cada cambio.
 */
describe('socialImageVersion (#274)', () => {
  it('es determinista para el mismo estado', () => {
    expect(socialImageVersion('CPC 2-2 LUB|desc')).toBe(
      socialImageVersion('CPC 2-2 LUB|desc'),
    );
  });

  it('cambia cuando cambia el marcador o el estado', () => {
    expect(socialImageVersion('CPC 2-2 LUB')).not.toBe(
      socialImageVersion('CPC 3-2 LUB'),
    );
    // programado (" - ") vs en directo/finalizado (" 0-0 ")
    expect(socialImageVersion('CPC - LUB')).not.toBe(
      socialImageVersion('CPC 0-0 LUB'),
    );
  });

  it('devuelve un token seguro para URL (solo [0-9a-z])', () => {
    expect(socialImageVersion('CPC 2-2 LUB · EN DIRECTO')).toMatch(/^[0-9a-z]+$/);
  });
});

describe('socialImageUrl (#274)', () => {
  it('construye la URL absoluta con el token de versión', () => {
    expect(socialImageUrl('es', '/matches/abc', 'opengraph-image', 'v123')).toBe(
      `${SITE_URL}/es/matches/abc/opengraph-image?v=v123`,
    );
  });

  it('maneja la raíz sin doble barra', () => {
    expect(socialImageUrl('en', '/', 'twitter-image', 'v123')).toBe(
      `${SITE_URL}/en/twitter-image?v=v123`,
    );
  });
});

describe('socialMeta (#273, #274)', () => {
  const base = {
    locale: 'es' as const,
    path: '/matches/abc',
    title: 'CPC 2-2 LUB',
    description: 'Resultado del CPC - LUB en Stick Live.',
  };

  it('con imagen dinámica incluye la twitter card con los datos del partido (#273)', () => {
    const meta = socialMeta({ ...base, dynamicImage: true });
    expect(meta.twitter).toMatchObject({
      card: 'summary_large_image',
      title: base.title,
      description: base.description,
    });
  });

  it('con imagen dinámica versiona las URLs de imagen por estado (#274)', () => {
    const meta = socialMeta({ ...base, dynamicImage: true });
    const version = socialImageVersion(`${base.title}|${base.description}`);
    const ogImages = meta.openGraph?.images as Array<{ url: string }>;
    expect(ogImages[0]?.url).toBe(
      socialImageUrl('es', base.path, 'opengraph-image', version),
    );
    expect(meta.twitter?.images).toEqual([
      socialImageUrl('es', base.path, 'twitter-image', version),
    ]);
  });

  it('el token de la imagen cambia al cambiar el marcador (#274)', () => {
    const a = socialMeta({ ...base, dynamicImage: true });
    const b = socialMeta({ ...base, title: 'CPC 3-2 LUB', dynamicImage: true });
    const urlA = (a.openGraph?.images as Array<{ url: string }>)[0]?.url;
    const urlB = (b.openGraph?.images as Array<{ url: string }>)[0]?.url;
    expect(urlA).not.toBe(urlB);
  });

  it('sin imagen dinámica mantiene la imagen estática por defecto (sin regresión)', () => {
    const meta = socialMeta({ ...base });
    const ogImages = meta.openGraph?.images as Array<{ url: string }>;
    expect(ogImages[0]?.url).toBe(`${SITE_URL}/og-image.png`);
    expect(meta.twitter?.images).toEqual([`${SITE_URL}/og-image.png`]);
  });
});
