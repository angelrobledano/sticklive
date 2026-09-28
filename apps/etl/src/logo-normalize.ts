/**
 * Normalización de escudos (PNG) para que se vean bien sobre cualquier fondo.
 *
 * Los escudos de origen llegan con transparencia y márgenes irregulares: en
 * fondos oscuros (modo oscuro y tarjeta OG) los de colores oscuros desaparecen.
 * Aquí se rellena la transparencia en blanco, se recorta el borde sobrante, se
 * añade un margen uniforme y se reduce a un tamaño común.
 *
 * Es idempotente: un PNG ya normalizado (sin alfa y de LOGO_SIZE×LOGO_SIZE) no
 * se vuelve a tocar. En el buffer esto exige un guard explícito al principio,
 * porque sobre escudos reales con bordes anti-aliased una segunda pasada de
 * `trim()` puede encontrar un bounding box ligeramente mayor y "crecer" el
 * contenido.
 */
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';

/** Color de relleno de la transparencia. Debe coincidir con el fondo de TeamShield. */
export const LOGO_BACKGROUND = '#ffffff';
/** Lado final en px (cuadrado). */
export const LOGO_SIZE = 512;
/** Margen por lado como fracción del lado final (6 %). */
export const LOGO_MARGIN = 0.06;

const PAD = Math.round(LOGO_SIZE * LOGO_MARGIN);
const INNER_SIZE = LOGO_SIZE - 2 * PAD;

/**
 * Normaliza un PNG en memoria y devuelve el PNG normalizado (512×512, opaco).
 *
 * Si la entrada ya está normalizada (sin alfa y de LOGO_SIZE×LOGO_SIZE) se
 * devuelve tal cual, lo que hace la operación idempotente a nivel de buffer.
 *
 * Orden importante: `trim()` va ANTES de `flatten()` porque necesita el canal
 * alfa para saber qué es fondo; `removeAlpha()` va después para que la salida
 * sea realmente opaca (y la detección de idempotencia funcione). `trim()`
 * requiere imágenes de al menos 3×3 px (limitación de libvips); los escudos
 * reales siempre lo cumplen.
 */
export async function normalizeLogoBuffer(input: Buffer): Promise<Buffer> {
  // Ya normalizado (512×512 sin alfa): devolverlo tal cual. Sin esto, una
  // segunda pasada sobre un escudo real con bordes anti-aliased puede recortar
  // un bounding box ligeramente mayor y "crecer" el contenido.
  const meta = await sharp(input).metadata();
  if (!meta.hasAlpha && meta.width === LOGO_SIZE && meta.height === LOGO_SIZE) {
    return input;
  }

  const { data, info } = await sharp(input)
    .trim()
    .flatten({ background: LOGO_BACKGROUND })
    .removeAlpha()
    .resize(INNER_SIZE, INNER_SIZE, { fit: 'inside' })
    .png()
    .toBuffer({ resolveWithObject: true });

  const left = Math.floor((LOGO_SIZE - info.width) / 2);
  const top = Math.floor((LOGO_SIZE - info.height) / 2);

  return sharp(data)
    .extend({
      top,
      bottom: LOGO_SIZE - info.height - top,
      left,
      right: LOGO_SIZE - info.width - left,
      background: LOGO_BACKGROUND,
    })
    .png()
    .toBuffer();
}

/**
 * Normaliza un fichero PNG in-place si lo necesita.
 *
 * - `'skipped'`    → ya estaba normalizado (sin alfa y 512×512).
 * - `'normalized'` → se reescribió.
 *
 * Propaga el error si el fichero es ilegible: el llamante lo registra por ítem
 * y continúa con el resto del lote.
 */
export async function normalizeLogoFile(filePath: string): Promise<'normalized' | 'skipped'> {
  const meta = await sharp(filePath).metadata();
  // Suposición: un PNG opaco que ya sea 512×512 se considera normalizado aunque
  // quizá no haya recibido el margen uniforme (tradeoff aceptado; hoy no hay
  // casos de escudos opacos ya a 512×512 en origen).
  if (!meta.hasAlpha && meta.width === LOGO_SIZE && meta.height === LOGO_SIZE) {
    return 'skipped';
  }
  const input = await readFile(filePath);
  await writeFile(filePath, await normalizeLogoBuffer(input));
  return 'normalized';
}
