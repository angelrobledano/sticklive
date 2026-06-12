/**
 * RUNNER DE FIN DE SEMANA — todo el scraping pendiente, en cadena.
 *
 * Pensado para dejar el PC encendido (IP residencial) escribiendo en la BD
 * del servidor vía túnel SSH. Cada fase es resumible: si algo se corta,
 * relanzar este script retoma donde estaba.
 *
 * Fases:
 *   1. Federaciones (FMP, FAP, FECAPA, FPCV, FGP): catálogo + siembra +
 *      calendario + clasificaciones de todas sus temporadas.
 *   2. Actas de cada federación (cada portal en su proceso, con su prefijo).
 *   3. Actas RFEP que sigan pendientes.
 *   4. Refichas de crono (actas RFEP guardadas sin MM:SS).
 *
 * Uso (con DATABASE_URL apuntando al túnel):
 *   npx tsx --env-file=../../.env src/weekend-runner.ts
 */
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { FEDERATIONS } from './federations.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CWD = resolve(HERE, '..');

function phase(title: string, cmd: string, env: Record<string, string> = {}) {
  console.log(`\n${'═'.repeat(60)}\n■ ${title}\n${'═'.repeat(60)}`);
  try {
    execSync(cmd, { cwd: CWD, stdio: 'inherit', env: { ...process.env, ...env } });
  } catch {
    console.error(`⚠️  Fase "${title}" terminó con errores — continuando con la siguiente.`);
  }
}

async function main() {
  const startedAt = Date.now();

  // ── Fase 1: federaciones completas (calendarios + clasificaciones) ────────
  phase(
    'Federaciones: catálogos + siembra + calendario + clasificación',
    'npx tsx src/import-federations.ts --run'
  );

  // ── Fase 2: actas de cada federación (un proceso por portal) ──────────────
  for (const fed of FEDERATIONS) {
    phase(
      `Actas ${fed.org} (${fed.region})`,
      `npx tsx src/import-history-fichas.ts --org=${fed.org}`,
      { SIDGAD_PORTAL: fed.prefix, SIDGAD_REFERER: fed.referer }
    );
  }

  // ── Fase 3: actas RFEP pendientes ──────────────────────────────────────────
  phase('Actas RFEP pendientes', 'npx tsx src/import-history-fichas.ts --org=RFEP');

  // ── Fase 4: refichas de crono (RFEP antiguas sin MM:SS) ────────────────────
  phase('Refichas de crono', 'npx tsx src/refichas-clock.ts');

  const hours = ((Date.now() - startedAt) / 3_600_000).toFixed(1);
  console.log(`\n🏁 Fin de semana completado en ${hours} h. Buen viaje de vuelta.`);
}

main().catch((err) => { console.error('❌', err); process.exit(1); });
