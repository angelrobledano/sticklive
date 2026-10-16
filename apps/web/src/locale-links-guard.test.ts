import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { findUnprefixedEntityLinks } from './lib/locale-links';

/**
 * Guardia de CI de SEO-01 (`docs/AUDITORIA_SEO_2026-10-16.md`, F1-1).
 *
 * Los enlaces internos deben salir con el idioma delante. El prefijo lo pone
 * `LocaleLink` en tiempo de render, así que el código fuente puede seguir
 * escribiendo `href={`/teams/${id}`}`: lo que no puede es saltarse LocaleLink.
 * Esta guardia falla si alguien vuelve a importar `next/link` directamente, si
 * pinta un `<a>` crudo hacia una ficha o si navega por código a una ruta de la
 * app sin pasar por `withLocaleHref`.
 */

const SRC = join(__dirname);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [full];
  });
}

const files = sourceFiles(SRC).map((full) => ({
  path: relative(SRC, full).split(sep).join('/'),
  source: readFileSync(full, 'utf8'),
}));

describe('guardia de enlaces internos con idioma (SEO-01)', () => {
  it('nadie importa next/link salvo LocaleLink', () => {
    const offenders = files
      .filter((f) => f.path !== 'components/shared/LocaleLink.tsx')
      .filter((f) => /from ['"]next\/link['"]/.test(f.source))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('no hay <a> crudos hacia fichas sin prefijo', () => {
    const offenders = files.flatMap((f) =>
      (f.source.match(/<a\s[^>]*>/g) ?? [])
        .filter((tag) => findUnprefixedEntityLinks(tag).length > 0)
        .map((tag) => `${f.path}: ${tag}`),
    );
    expect(offenders).toEqual([]);
  });

  it('la navegación por código a rutas de la app pasa por withLocaleHref', () => {
    // `router.push('/teams/x')` o `router.replace('/')` con la ruta escrita a
    // mano. Las rutas construidas con el locale (`/${l}…`) o a partir de
    // `pathname` (que ya lo lleva) no entran.
    const re = /router\.(push|replace)\(\s*[`'"]\/(?!\$\{)/g;
    const offenders = files.flatMap((f) => (f.source.match(re) ?? []).map((m) => `${f.path}: ${m}`));
    expect(offenders).toEqual([]);
  });
});
