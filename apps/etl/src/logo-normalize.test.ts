import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { normalizeLogoBuffer, normalizeLogoFile, LOGO_SIZE } from './logo-normalize.js';

/**
 * PNG cuadrado `size`×`size` con un cuadrado opaco de `size - 2*inset` centrado
 * y el resto transparente. `inset = 0` produce un PNG con canal alfa 100 % opaco.
 */
async function fixture(size = 400, inset = 100): Promise<Buffer> {
  const inner = size - 2 * inset;
  const solid = await sharp({
    create: { width: inner, height: inner, channels: 4, background: { r: 20, g: 40, b: 200, alpha: 1 } },
  }).png().toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: solid, left: inset, top: inset }]).png().toBuffer();
}

const isWhite = (d: Buffer, i: number) => d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255;

describe('normalizeLogoBuffer', () => {
  it('aplana la transparencia: 512×512, opaco, esquina blanca', async () => {
    const out = await normalizeLogoBuffer(await fixture());
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(LOGO_SIZE);
    expect(meta.height).toBe(LOGO_SIZE);
    expect(meta.hasAlpha).toBe(false);

    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    expect(isWhite(data, 0)).toBe(true);
  });

  it('recorta el borde transparente y deja margen alrededor del contenido', async () => {
    const out = await normalizeLogoBuffer(await fixture(400, 150));
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });

    const rowAllWhite = (y: number) => {
      for (let x = 0; x < info.width; x++) {
        if (!isWhite(data, (y * info.width + x) * info.channels)) return false;
      }
      return true;
    };
    expect(rowAllWhite(0)).toBe(true);
    expect(rowAllWhite(info.height - 1)).toBe(true);

    const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    expect(isWhite(data, center)).toBe(false);
  });

  it('redimensiona un PNG opaco no cuadrado a 512×512', async () => {
    const opaque = await sharp({
      create: { width: 300, height: 100, channels: 3, background: '#3366cc' },
    }).png().toBuffer();
    const meta = await sharp(await normalizeLogoBuffer(opaque)).metadata();
    expect(meta.width).toBe(LOGO_SIZE);
    expect(meta.height).toBe(LOGO_SIZE);
    expect(meta.hasAlpha).toBe(false);
  });

  it('no falla con un PNG que declara alfa pero es 100 % opaco', async () => {
    const meta = await sharp(await normalizeLogoBuffer(await fixture(200, 0))).metadata();
    expect(meta.width).toBe(LOGO_SIZE);
    expect(meta.hasAlpha).toBe(false);
  });

  it('es idempotente', async () => {
    const once = await normalizeLogoBuffer(await fixture());
    const twice = await normalizeLogoBuffer(once);
    expect(Buffer.compare(once, twice)).toBe(0);
  });
});

describe('normalizeLogoFile', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('normaliza un fichero con transparencia y en la segunda pasada lo salta', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'logo-'));
    dirs.push(dir);
    const file = join(dir, 'team.png');
    writeFileSync(file, await fixture());

    expect(await normalizeLogoFile(file)).toBe('normalized');
    const meta = await sharp(readFileSync(file)).metadata();
    expect(meta.width).toBe(LOGO_SIZE);
    expect(meta.height).toBe(LOGO_SIZE);
    expect(meta.hasAlpha).toBe(false);

    expect(await normalizeLogoFile(file)).toBe('skipped');
  });
});
