import { describe, expect, it } from 'vitest';
import {
  SATORI_PHOTO_WIDTH,
  isSatoriRenderableImage,
  playerPhotoUrlForSatori,
} from './og-image';

describe('playerPhotoUrlForSatori', () => {
  it('pide PNG al ancho de Satori, sin dobles barras', () => {
    const url = playerPhotoUrlForSatori('https://sticklive.eu/api/', 'p1');

    expect(url).toBe(
      `https://sticklive.eu/api/players/p1/photo?w=${SATORI_PHOTO_WIDTH}&format=png`,
    );
  });
});

describe('isSatoriRenderableImage', () => {
  it('acepta PNG y JPEG, con o sin charset', () => {
    expect(isSatoriRenderableImage('image/png')).toBe(true);
    expect(isSatoriRenderableImage('image/png; charset=utf-8')).toBe(true);
    expect(isSatoriRenderableImage('image/jpeg')).toBe(true);
    expect(isSatoriRenderableImage('IMAGE/JPEG')).toBe(true);
  });

  it('rechaza WebP, SVG, GIF y respuestas que no son imagen', () => {
    for (const contentType of [
      'image/webp',
      'image/svg+xml',
      'image/gif',
      'application/json',
      null,
      undefined,
    ]) {
      expect(isSatoriRenderableImage(contentType), String(contentType)).toBe(false);
    }
  });
});
