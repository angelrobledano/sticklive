import { closeDb } from '@sports/db';
import { downloadTeamLogos, escudosDir } from './team-logos.js';

/**
 * CLI operativo: sincroniza el volumen de escudos a mano.
 *   npx tsx --env-file .env apps/etl/src/download-logos.ts
 *
 * La lógica vive en `team-logos.ts` (compartida con la entidad `download-logos`
 * de `run-pipeline`, que el scheduler ejecuta cada hora). Este script queda para
 * lanzarlo puntualmente por el túnel SSH sin esperar al cron.
 */
async function main(): Promise<void> {
  console.log('Destino:', escudosDir());
  const summary = await downloadTeamLogos();
  console.log('Resumen:', summary);
  await closeDb();
}

main().catch((e) => { console.error('Error:', e); process.exit(1); });
