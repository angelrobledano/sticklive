import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Regresión de codificación. Bug real en producción: en/fr/it/pt quedaron
 * doblemente codificados (UTF-8 leído como Windows-1252 y reguardado como
 * UTF-8), así que el usuario veía "9thâ€“10th" en vez de "9th–10th", "Chargementâ€¦"
 * en vez de "Chargement…", etc. Este test impide que vuelva a colarse.
 *
 * Se usan escapes unicode para no reintroducir el problema en este mismo fichero.
 */

const LOCALES = ['es', 'ca', 'en', 'fr', 'it', 'pt'] as const;

describe('locales — codificación UTF-8', () => {
  for (const loc of LOCALES) {
    it(`${loc}.json es JSON válido y sin mojibake`, () => {
      const raw = readFileSync(fileURLToPath(new URL(`./${loc}.json`, import.meta.url)), 'utf8');

      expect(() => JSON.parse(raw)).not.toThrow();
      // "â€" (U+00E2 U+20AC): comienzo del mojibake de puntuación (…, –, etc.)
      expect(raw).not.toMatch(/\u00E2\u20AC/);
      // "Ã" (U+00C3) seguido de un byte de continuación de cp1252: acentos rotos (Ã©, Ã±…)
      expect(raw).not.toMatch(/\u00C3[\u0080-\u00BF]/);
    });
  }
});
