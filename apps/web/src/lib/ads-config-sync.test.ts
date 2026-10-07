import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/**
 * Guardia anti-deriva (#382): los nombres `NEXT_PUBLIC_ADS*` que el código LEE
 * deben existir en la infraestructura que los cablea:
 *   · `docker-compose.prod.yml` — build args del servicio `web`.
 *   · `deploy/Dockerfile` — `ARG` + `ENV` antes de `next build`.
 *   · `.env.prod.example` — plantilla operativa.
 *
 * Son variables de BUILD (se hornean en el bundle): un desajuste de nombre NO
 * falla con un error, simplemente deja de servirse el anuncio. Ya ocurrió una
 * vez (el código leía `..._SLOT_HOME_TOP` mientras la plantilla ofrecía
 * `..._SLOT_BANNER`), así que lo cubrimos con un test. Vive en la web porque es
 * quien consume las variables.
 */

const HERE = dirname(fileURLToPath(import.meta.url)); // apps/web/src/lib
const REPO_ROOT = resolve(HERE, '../../../../'); // raíz del monorepo

/** Claves literales que el código lee de `process.env`. */
const READ_RE = /process\.env\[['"](NEXT_PUBLIC_ADS[A-Z0-9_]*)['"]\]/g;
/** Cualquier identificador de variable, para localizarlo en la infra. */
const IDENT_RE = /NEXT_PUBLIC_ADS[A-Z0-9_]*/g;

function read(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), 'utf8');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sorted(values: string[]): string[] {
  return [...values].sort();
}

const adsSource = read('apps/web/src/lib/ads.ts');
const composeSource = read('docker-compose.prod.yml');
const dockerfileSource = read('deploy/Dockerfile');
const envExampleSource = read('.env.prod.example');

const codeNames = unique([...adsSource.matchAll(READ_RE)].map((m) => m[1]!));
const composeNames = unique(composeSource.match(IDENT_RE) ?? []);
const dockerfileNames = unique(dockerfileSource.match(IDENT_RE) ?? []);
const envExampleNames = unique(envExampleSource.match(IDENT_RE) ?? []);

describe('sincronía de variables NEXT_PUBLIC_ADS* (código ↔ infra)', () => {
  it('el código declara al menos una variable (sanity)', () => {
    expect(codeNames.length).toBeGreaterThan(0);
  });

  it('docker-compose declara exactamente las mismas variables que el código', () => {
    expect(sorted(composeNames)).toEqual(sorted(codeNames));
  });

  it('Dockerfile declara (ARG) todas las variables que el código lee', () => {
    for (const name of codeNames) {
      expect(dockerfileNames, `falta ${name} en deploy/Dockerfile`).toContain(name);
    }
  });

  it('.env.prod.example incluye todas las variables que el código lee', () => {
    for (const name of codeNames) {
      expect(envExampleNames, `falta ${name} en .env.prod.example`).toContain(name);
    }
  });
});
