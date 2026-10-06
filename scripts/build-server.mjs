/**
 * Empaqueta los procesos de servidor (api, etl, scraper, scripts de BD) a
 * JavaScript ejecutable con `node`, sin `tsx` ni `ts-node`.
 *
 * ── Por qué empaquetar y no `tsc` a secas ─────────────────────────
 *
 * Los paquetes del workspace exponen TypeScript directamente:
 *
 *     packages/db/package.json → "main": "./src/index.ts"
 *
 * Eso sólo funciona con un cargador que transpile al vuelo. Compilar cada
 * paquete por separado obligaría a reescribir todos los `main`/`exports` a
 * `dist/`, y además hay imports relativos que cruzan de una app a otra
 * (`apps/etl/src/cron-live.ts` importa `../../scraper/src/...`), que con
 * `rootDir`/`outDir` por paquete acaban en referencias de proyecto y rutas
 * frágiles. Empaquetar resuelve todo eso de una vez: cada entrypoint sale como
 * un único fichero con nuestro código dentro.
 *
 * ── Qué queda FUERA del bundle ────────────────────────────────
 *
 * Todo `node_modules` es external; sólo se empaqueta el código propio
 * (`@sports/*` y las rutas relativas). Dos razones:
 *
 *   · `@sentry/node` instrumenta módulos interceptando su carga. Metido en un
 *     bundle deja de ver esas cargas y la instrumentación automática se cae.
 *   · `playwright` descarga navegadores y resuelve rutas propias en runtime;
 *     empaquetarlo no funciona.
 *
 * Como contrapartida, la imagen de runtime necesita `npm ci --omit=dev`. Que
 * es justo lo que se busca: en producción dejan de existir `tsx`, `typescript`
 * ni el resto de devDependencies, y `npm audit --omit=dev` pasa a auditar lo
 * que de verdad corre.
 *
 * ── Estructura de salida ────────────────────────────────────
 *
 * `outbase` es la raíz del repo, así que la jerarquía se conserva:
 *
 *     dist/apps/etl/src/cron-live.js
 *     dist/packages/db/src/migrate.js
 *
 * No es cosmético: mantiene una correspondencia 1:1 con el código fuente, de
 * modo que un stack trace de producción se lee sin traducir rutas.
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Procesos de larga vida y tareas del planificador. */
const SERVICIOS = [
  'apps/api/src/index.ts',                    // servidor Hono
  'apps/etl/src/cron-live.ts',                // ciclo de directo
  'apps/etl/src/run-pipeline.ts',             // calendario, standings, actas, escudos
  'apps/scraper/src/index.ts',                // CLI de scrapers (--run-once)
  'packages/db/src/migrate.ts',               // migraciones (servicio `migrate`)
  'packages/db/scripts/purge-scrape-logs.ts', // purga diaria
  'apps/etl/src/partition-guard.ts',          // guarda diaria del particionado (047)
  'apps/etl/src/scrape-health-watch.ts',      // vigilante diario de salud del scraping (I3)
  'apps/etl/src/integrity-check.ts',          // check diario de integridad de datos (#231)
  'apps/etl/src/audit-integrity-report.ts',   // informe histórico versionado, a mano (#237)
  'apps/etl/src/play-reconcile.ts',           // reconciliación diaria de compras Play (monetización)
];

/**
 * Scripts operativos que se lanzan A MANO contra producción, casi todos desde
 * docs/RUNBOOK_COMPETICIONES.md y docs/DEPLOY.md.
 *
 * Van empaquetados por una razón concreta: antes se ejecutaban con
 * `$DC exec etl npx tsx apps/etl/src/seed-ok-liga.ts`, y en la imagen nueva no
 * hay `tsx`. Sin esta lista, dar de alta una competición en septiembre —el
 * flujo operativo principal— habría dejado de funcionar, y el fallo habría
 * aparecido justo cuando hiciera falta.
 *
 * Sólo entran scripts AUTOCONTENIDOS: que no lean ficheros de datos del repo
 * ni lancen subprocesos. Los `import-*` quedan fuera por las dos cosas —
 * `import-federations` y `import-history-fichas` hacen `execSync('npx tsx …')`,
 * que en esta imagen ya no existe, e `import-history` necesita
 * `apps/scraper/logs/fep-catalog.json`, que tampoco se copia. Empaquetarlos
 * daría un script que arranca y revienta a media faena, peor que no tenerlo.
 *
 * Eso y lo demás que no está aquí (depuración, pruebas de Sentry, backfills
 * históricos ya consumidos) se ejecuta desde el portátil por el túnel SSH
 * contra el Postgres de producción, que es justo para lo que existe: son
 * trabajos largos y masivos que además conviene lanzar desde IP residencial
 * (ver docs/DEPLOY.md).
 */
const OPERATIVOS = [
  'apps/etl/src/seed-ok-liga.ts',
  'apps/etl/src/seed-playoff-teams.ts',
  'apps/etl/src/seed-worldskate-u17.ts',
  'apps/etl/src/seed-worldskate-u17-women.ts',
  'apps/etl/src/seed-worldskate-asu26.ts',     // WSG Asunción 2026 (idc 325/329/330/331)
  'apps/etl/src/seed-competition-sources.ts',
  'apps/etl/src/seed-fep-competition.ts',      // seed genérico por idc (2026/27)
  'apps/etl/src/split-filial-teams.ts',        // reparación filiales conflados (one-off)
  'apps/etl/src/link-lineup-players.ts',
  'apps/etl/src/backfill-season-teams-from-lineups.ts', // season_teams desde alineaciones (#220)
  'apps/etl/src/cleanup-intruder-team-events.ts',       // reparación eventos intrusos (#325)
  'apps/etl/src/enqueue-team-duplicates.ts',            // candidatos de higiene de equipos → cola HITL (#200)
  'apps/etl/src/merge-canonical-competitions.ts',
  'apps/etl/src/cleanup-synthetic-dupes.ts',
  'apps/etl/src/update-player-photos.ts',
  'apps/etl/src/download-logos.ts',
  'apps/etl/src/normalize-logos.ts',
  'packages/db/scripts/verify-event-upsert.ts',
];

const ENTRYPOINTS = [...SERVICIOS, ...OPERATIVOS];

/**
 * Todo lo que venga de npm se queda fuera. Se recolecta de los package.json en
 * vez de mantener una lista a mano, que se quedaría desactualizada en silencio
 * la primera vez que alguien añada una dependencia.
 */
function externalDeps() {
  const dirs = ['.', ...['apps', 'packages'].flatMap((d) =>
    readdirSync(join(ROOT, d)).map((sub) => `${d}/${sub}`))];

  const names = new Set();
  for (const dir of dirs) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf-8'));
    } catch {
      continue; // no todos los directorios son un paquete
    }
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      // @sports/* es código nuestro: ESO sí entra en el bundle. Si quedara
      // fuera, node intentaría cargar packages/db/src/index.ts en runtime.
      if (!dep.startsWith('@sports/')) names.add(dep);
    }
  }
  return [...names];
}

const external = externalDeps();

await build({
  entryPoints: ENTRYPOINTS.map((e) => join(ROOT, e)),
  outbase: ROOT,
  outdir: join(ROOT, 'dist'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,       // stack traces legibles en Sentry
  external,
  logLevel: 'info',
  // Los paquetes son "type": "module" y la salida es ESM, pero alguna
  // dependencia external puede ser CJS y usar `require`. Este banner da un
  // `require` funcional dentro del contexto ESM.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
});

/**
 * La salida es ESM, pero el package.json de la raíz no declara
 * `"type": "module"`. Sin esto node avisa en cada arranque:
 *
 *     [MODULE_TYPELESS_PACKAGE_JSON] ... Reparsing as ES module
 *     ... This incurs a performance overhead.
 *
 * Se declara aquí, en dist/, y no en el package.json de la raíz: ahí afectaría
 * a todo el repo (herramientas, tests, ficheros de configuración) para arreglar
 * algo que sólo pasa en la salida compilada.
 */
mkdirSync(join(ROOT, 'dist'), { recursive: true });
writeFileSync(
  join(ROOT, 'dist', 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2) + '\n'
);

console.log(`\n✅ ${ENTRYPOINTS.length} entrypoints empaquetados en dist/`);
console.log(`   ${external.length} dependencias externas (se instalan con npm ci --omit=dev)`);
