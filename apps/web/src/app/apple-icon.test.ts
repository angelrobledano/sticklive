import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * #342 — iOS necesita un `apple-touch-icon`; sin él, "Añadir a pantalla de
 * inicio" instala la PWA con un screenshot de la página como icono.
 *
 * Se sirve por la convención de Next `app/apple-icon.png` (Next emite
 * `<link rel="apple-touch-icon">`, igual que ya hace con `app/icon.svg`) y
 * además se publica en `/apple-touch-icon.png`, la ruta que iOS sondea por
 * defecto (el 404 medido en la auditoría).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function assertValidAppleIcon(relPath: string) {
  const buf = readFileSync(resolve(HERE, relPath));
  expect(buf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  expect(width).toBe(height);
  expect(width).toBeGreaterThanOrEqual(180);
}

describe('apple-touch-icon (#342)', () => {
  it('app/apple-icon.png es un PNG cuadrado >= 180px (convención Next)', () => {
    assertValidAppleIcon('apple-icon.png');
  });

  it('public/apple-touch-icon.png es un PNG cuadrado >= 180px (ruta que iOS sondea)', () => {
    assertValidAppleIcon('../../public/apple-touch-icon.png');
  });
});
