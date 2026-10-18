import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  DEFAULT_IMAGE_WIDTH,
  IMAGE_WIDTH_PRESETS,
  LOGO_BACKGROUND,
  resolveImageFormat,
  resolveImageWidth,
  renderNormalizedLogo,
  renderResizedImage,
} from './image.js';

const MAX_PRESET = IMAGE_WIDTH_PRESETS[IMAGE_WIDTH_PRESETS.length - 1];

/** Lee un píxel RGB(A) del buffer crudo devuelto por sharp. */
function pixelAt(
  data: Buffer,
  width: number,
  x: number,
  y: number,
  channels: number
): { r: number; g: number; b: number } {
  const i = (y * width + x) * channels;
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
}

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

describe('resolveImageFormat (OG/Satori)', () => {
  it('solo `png` explícito cambia el formato; el resto sigue en WebP', () => {
    expect(resolveImageFormat('png')).toBe('png');
    expect(resolveImageFormat('PNG')).toBe('png');
    expect(resolveImageFormat(' png ')).toBe('png');

    for (const raw of [undefined, null, '', 'webp', 'jpg', 'jpeg', 'avif', 'basura']) {
      expect(resolveImageFormat(raw), String(raw)).toBe('webp');
    }
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

  it('sirve PNG cuando se pide format=png (Satori no decodifica WebP)', async () => {
    const src = await sharp({
      create: { width: 512, height: 512, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).webp().toBuffer();

    const meta = await sharp(await renderResizedImage(src, 96, 'png')).metadata();

    expect(meta.format).toBe('png');
    expect(meta.width).toBe(96);
  });
});

describe('renderNormalizedLogo (#385)', () => {
  it('devuelve un WebP cuadrado y opaco del ancho pedido', async () => {
    const src = await sharp({
      create: { width: 240, height: 180, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } },
    }).png().toBuffer();

    const meta = await sharp(await renderNormalizedLogo(src, 96)).metadata();

    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(96);
    expect(meta.height).toBe(96);
    expect(meta.hasAlpha).toBe(false);
  });

  it('aplana la transparencia sobre blanco (fondo opaco)', async () => {
    // Bloque rojo opaco desplazado sobre un lienzo transparente con margen.
    const inner = await sharp({
      create: { width: 60, height: 60, channels: 4, background: { r: 220, g: 20, b: 20, alpha: 1 } },
    }).png().toBuffer();
    const src = await sharp({
      create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: inner, top: 70, left: 0 }])
      .png()
      .toBuffer();

    const { data, info } = await sharp(await renderNormalizedLogo(src, 128))
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(info.channels).toBeGreaterThanOrEqual(3);
    const corner = pixelAt(data, info.width, 0, 0, info.channels);
    // LOGO_BACKGROUND es blanco: la esquina (antes transparente) debe serlo.
    expect(corner.r).toBeGreaterThan(240);
    expect(corner.g).toBeGreaterThan(240);
    expect(corner.b).toBeGreaterThan(240);
    expect(LOGO_BACKGROUND).toBe('#ffffff');
  });

  it('recorta el margen sobrante y centra el contenido', async () => {
    const inner = await sharp({
      create: { width: 80, height: 80, channels: 4, background: { r: 0, g: 80, b: 220, alpha: 1 } },
    }).png().toBuffer();
    // Contenido descentrado con margen transparente por los cuatro lados: así
    // `trim()` puede usar la esquina transparente como fondo y recortar.
    const src = await sharp({
      create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: inner, top: 30, left: 150 }])
      .png()
      .toBuffer();

    const { data, info } = await sharp(await renderNormalizedLogo(src, 120))
      .raw()
      .toBuffer({ resolveWithObject: true });

    const half = info.width >> 1;
    const center = pixelAt(data, info.width, half, half, info.channels);
    expect(center.b).toBeGreaterThan(150);
    expect(center.b).toBeGreaterThan(center.r);

    // El margen uniforme deja la esquina blanca.
    const corner = pixelAt(data, info.width, 0, 0, info.channels);
    expect(corner.r).toBeGreaterThan(240);
    expect(corner.g).toBeGreaterThan(240);
    expect(corner.b).toBeGreaterThan(240);
  });

  it('reescala un escudo ya opaco y cuadrado al ancho pedido', async () => {
    const src = await sharp({
      create: { width: 512, height: 512, channels: 3, background: { r: 10, g: 120, b: 200 } },
    }).png().toBuffer();

    const meta = await sharp(await renderNormalizedLogo(src, 64)).metadata();

    expect(meta.width).toBe(64);
    expect(meta.height).toBe(64);
    expect(meta.hasAlpha).toBe(false);
  });
});
