import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  DEFAULT_IMAGE_WIDTH,
  IMAGE_WIDTH_PRESETS,
  resolveImageWidth,
  renderResizedImage,
} from './image.js';

const MAX_PRESET = IMAGE_WIDTH_PRESETS[IMAGE_WIDTH_PRESETS.length - 1];

describe('resolveImageWidth (#335)', () => {
  it('cae al ancho por defecto si no hay w o no es válido', () => {
    for (const raw of [undefined, null, '', '   ', 'abc', '0', '-5', 'NaN']) {
      expect(resolveImageWidth(raw), String(raw)).toBe(DEFAULT_IMAGE_WIDTH);
    }
  });

  it('devuelve el preset exacto cuando se pide justo un preset', () => {
    for (const preset of IMAGE_WIDTH_PRESETS) {
      expect(resolveImageWidth(String(preset)), String(preset)).toBe(preset);
    }
  });

  it('redondea HACIA ARRIBA al preset más pequeño que cubre lo pedido', () => {
    expect(resolveImageWidth('33')).toBe(64);
    expect(resolveImageWidth('50')).toBe(64);
    expect(resolveImageWidth('65')).toBe(96);
    expect(resolveImageWidth('200')).toBe(256);
  });

  it('acota por arriba al mayor preset (no permite anchos arbitrarios)', () => {
    expect(resolveImageWidth('100000')).toBe(MAX_PRESET);
    expect(resolveImageWidth(String(Number.MAX_SAFE_INTEGER))).toBe(MAX_PRESET);
  });
});

describe('renderResizedImage (#335)', () => {
  it('reencoda a WebP con el ancho pedido', async () => {
    const src = await sharp({
      create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    }).png().toBuffer();

    const meta = await sharp(await renderResizedImage(src, 96)).metadata();

    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(96);
    expect(meta.height).toBe(96);
  });

  it('nunca amplía una imagen más pequeña que el ancho pedido', async () => {
    const src = await sharp({
      create: { width: 40, height: 40, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();

    const meta = await sharp(await renderResizedImage(src, 256)).metadata();

    expect(meta.width).toBe(40);
    expect(meta.height).toBe(40);
  });

  it('conserva la proporción al redimensionar por ancho', async () => {
    const src = await sharp({
      create: { width: 400, height: 200, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).jpeg().toBuffer();

    const meta = await sharp(await renderResizedImage(src, 100)).metadata();

    expect(meta.width).toBe(100);
    expect(meta.height).toBe(50);
  });
});
