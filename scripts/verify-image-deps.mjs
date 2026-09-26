/**
 * Verificación de dependencias de la imagen de producción.
 *
 * Los bundles de dist/ dejan node_modules externo a propósito (@sentry/node
 * instrumenta interceptando la carga de módulos y dentro de un bundle deja de
 * verla; playwright resuelve rutas propias en runtime). Eso significa que el
 * runtime resuelve cada import externo con la cadena normal de Node desde
 * dist/: .../dist/node_modules → /app/node_modules. Un paquete anidado en
 * apps/<workspace>/node_modules —como le pasó a nodemailer en el crash-loop
 * del 26/09/2026— o olvidado en devDependencies no se descubre hasta que el
 * proceso importa; el CI compila la imagen pero no la ejecuta.
 *
 * Este script extrae los especificadores "bare" (paquetes, no rutas ni
 * node:) de todos los .js de dist/ y comprueba que cada uno se importa
 * correctamente desde la raíz de la imagen:
 *
 *   docker run --rm --network none \
 *     -v "$PWD/scripts/verify-image-deps.mjs:/app/verify-image-deps.mjs:ro" \
 *     --entrypoint node sticklive:ci /app/verify-image-deps.mjs /app/dist
 *
 * Regla de veredicto:
 *   - Fallo duro (exit 1): el paquete NO resuelve (ERR_MODULE_NOT_FOUND).
 *   - OK: el paquete resuelve e importa limpio, o resuelve pero lanza al
 *     importarse (env ausente, red...): eso es comportamiento de la librería
 *     en un entorno mínimo, no un problema de empaquetado.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';

const SPECIFIER =
  /(?:\bimport|\bexport)\s[^;'"]*?from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Especificadores "bare" (paquetes npm) referenciados por un bundle. */
export function extractBareSpecifiers(source) {
  const out = new Set();
  for (const m of source.matchAll(SPECIFIER)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec) continue;
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
    // Subpath imports: el paquete es el prefijo (@scope/name o name).
    const parts = spec.split('/');
    const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    // esbuild deja los builtins externos también sin el prefijo node: (fs,
    // path...). Resuelven siempre: no son dependencias de la imagen.
    if (builtinModules.includes(name)) continue;
    out.add(name);
  }
  return out;
}

function collectJsFiles(dir) {
  const files = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...collectJsFiles(p));
    else if (e.name.endsWith('.js')) files.push(p);
  }
  return files;
}

// ── main ────────────────────────────────────────────────────────────────────
const root = process.argv[2] ?? '/app/dist';
const files = collectJsFiles(root);
if (files.length === 0) {
  console.error(`✗ no hay bundles .js bajo ${root}: ¿se empaquetó el build?`);
  process.exit(1);
}

const pkgs = new Set();
for (const f of files) {
  for (const p of extractBareSpecifiers(readFileSync(f, 'utf8'))) pkgs.add(p);
}
console.log(`${files.length} bundles, ${pkgs.size} paquetes externos: ${[...pkgs].sort().join(', ')}\n`);

let faltan = 0;
for (const pkg of [...pkgs].sort()) {
  try {
    await import(pkg);
    console.log(`  ✓ ${pkg}`);
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') {
      console.error(`  ✗ ${pkg}: no resuelve desde /app (${String(err.message).split('\n')[0]})`);
      faltan++;
    } else {
      console.log(`  ✓ ${pkg} (resuelve; lanza al importarse: ${err?.code ?? String(err).slice(0, 60)})`);
    }
  }
}

if (faltan > 0) {
  console.error(`\n✗ ${faltan} paquete(s) no resuelven en la imagen: la API/ETL entraría en crash-loop.`);
  process.exit(1);
}
console.log('\n✓ todas las dependencias externas de dist/ resuelven en la imagen');
