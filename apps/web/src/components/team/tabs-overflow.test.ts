import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * #341: a 375 px la fila de tabs de la ficha de equipo desbordaba la página
 * (scrollWidth 394 vs 375). El fix es CSS (contenedor con scroll horizontal +
 * barra oculta); sin navegador en este entorno, fijamos el contrato en el
 * fuente para que un refactor no vuelva a introducir el overflow en silencio.
 * #365.1: `scrollbar-none` debe existir de verdad (antes era un no-op).
 */
function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('tabs con scroll horizontal interno (#341)', () => {
  it('la ficha de equipo no desborda: contenedor con overflow + scrollbar oculta', () => {
    const src = read('./TeamCenterClient.tsx');
    expect(src).toMatch(/flex gap-0 border-b[^`"]*overflow-x-auto scrollbar-none/);
  });

  it('la ficha de partido aplica el mismo fix (a 320 px desbordaba)', () => {
    const src = read('../match/MatchCenterClient.tsx');
    expect(src).toMatch(/flex gap-0 border-b[^`"]*overflow-x-auto scrollbar-none/);
  });
});

describe('utilidad scrollbar-none (#365.1)', () => {
  it('globals.css la define para Firefox y WebKit', () => {
    const css = read('../../app/globals.css');
    expect(css).toMatch(/\.scrollbar-none\s*\{/);
    expect(css).toMatch(/scrollbar-width:\s*none/);
    expect(css).toMatch(/\.scrollbar-none::-webkit-scrollbar/);
  });
});
