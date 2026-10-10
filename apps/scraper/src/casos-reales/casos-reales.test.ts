import { describe, it, expect, vi } from 'vitest';

// FepMatchesScraper exige FEP_SOURCE_ID al importarse.
vi.hoisted(() => {
  process.env['FEP_SOURCE_ID'] ??= '00000000-0000-0000-0000-000000000000';
});

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FepMatchesScraper } from '../scrapers/fep/fep-matches.scraper.js';
import {
  resumirCalendario, resumirFeedFep, resumirWorldskate,
  type CasoCalendario, type CasoFeed, type CasoWorldskate,
} from './resumen.js';

/**
 * Batería de CASOS REALES: páginas guardadas de la fuente (calendarios,
 * feed de directo, match center) y lo que la plataforma entiende de ellas.
 *
 * Dos niveles de verdad por caso (`casos-reales/<caso>/`):
 *  - `caso.json` → `formato`: el formato según las NORMAS de la federación,
 *    escrito a mano. Nunca se regenera: si el parser lo entiende distinto, el
 *    test falla aunque se acepte el detalle.
 *  - `esperado.json`: el detalle completo (fases, rondas, cada fila/partido).
 *    Se regenera con `npm run casos:actualizar` y se revisa en el diff.
 *
 * Ver casos-reales/README.md.
 */

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../casos-reales');
const ACTUALIZAR = process.env['ACTUALIZAR_CASOS'] === '1';
/** Reloj fijo: el instante en que se guardaron las páginas. */
const AHORA_POR_DEFECTO = '2026-10-08T15:00:00.000Z';

type Caso = (CasoCalendario | CasoWorldskate | CasoFeed) & {
  descripcion: string;
  fuente: string;
  capturado: string;
  /** Formato según las normas (no aplica al feed). */
  formato?: string;
  /** Comprobaciones puntuales escritas a mano (líneas que deben / no deben aparecer). */
  debeContener?: string[];
  noDebeContener?: string[];
};

const casos = readdirSync(RAIZ, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(RAIZ, d.name, 'caso.json')))
  .map((d) => d.name)
  .sort();

function resumir(nombre: string, caso: Caso): unknown {
  const leer = (f: string) => readFileSync(join(RAIZ, nombre, f), 'utf8');
  const ahora = new Date(caso.capturado || AHORA_POR_DEFECTO);
  if (caso.tipo === 'calendario') return resumirCalendario(caso, leer);
  if (caso.tipo === 'worldskate') return resumirWorldskate(caso, leer, ahora);
  const scraper = new FepMatchesScraper({ seasonId: 'temporada' });
  return resumirFeedFep(scraper.parseMatches(leer(caso.fichero), ahora));
}

describe('casos reales de la fuente', () => {
  it('hay casos', () => expect(casos.length).toBeGreaterThan(0));

  for (const nombre of casos) {
    describe(nombre, () => {
      const caso = JSON.parse(readFileSync(join(RAIZ, nombre, 'caso.json'), 'utf8')) as Caso;
      const salida = resumir(nombre, caso) as { formato?: string };
      const texto = JSON.stringify(salida, null, 2);

      if (caso.formato) {
        it(`formato según las normas: ${caso.formato}`, () => {
          expect(salida.formato).toBe(caso.formato);
        });
      }

      for (const linea of caso.debeContener ?? []) {
        it(`contiene: ${linea}`, () => expect(texto).toContain(linea));
      }
      for (const linea of caso.noDebeContener ?? []) {
        it(`no contiene: ${linea}`, () => expect(texto).not.toContain(linea));
      }

      it('detalle igual al aprobado (esperado.json)', () => {
        const ruta = join(RAIZ, nombre, 'esperado.json');
        if (ACTUALIZAR || !existsSync(ruta)) {
          writeFileSync(ruta, `${texto}\n`);
          if (!ACTUALIZAR) throw new Error(`Sin esperado.json: generado en ${ruta}. Revísalo y vuelve a lanzar.`);
          return;
        }
        expect(salida).toEqual(JSON.parse(readFileSync(ruta, 'utf8')));
      });
    });
  }
});
