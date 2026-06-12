/**
 * ACTAS DEL HISTÓRICO — descarga las fichas de partido de todas las temporadas.
 *
 * Recorre las temporadas sembradas por import-history (las que tienen un idc
 * numérico en source_ref) de la más reciente a la más antigua y lanza el
 * pipeline `fichas-pendientes` por cada una. Ese entity ya es incremental:
 * solo procesa partidos finalizados sin acta, así que este runner es
 * resumible — córtalo cuando quieras y relánzalo.
 *
 * En temporadas antiguas sin acta digital simplemente no encontrará nada:
 * el coste es una pasada en vacío, no un error.
 *
 * Uso:
 *   npx tsx --env-file=../../.env src/import-history-fichas.ts
 *   npx tsx --env-file=../../.env src/import-history-fichas.ts --since=2015   # solo desde 2015/16
 *   npx tsx --env-file=../../.env src/import-history-fichas.ts --limit=10     # primeras N temporadas
 */
import { db, closeDb } from '@sports/db';
import { createLogger } from '@sports/logger';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const log = createLogger({ service: 'history-fichas' });
const HERE = dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const since = args.find((a) => a.startsWith('--since='))?.split('=')[1];
  const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0);
  // Federaciones: cada portal sidgad va en proceso aparte (SIDGAD_PORTAL),
  // así que las actas se procesan filtrando por organizador.
  const org = args.find((a) => a.startsWith('--org='))?.split('=')[1] ?? null;

  // Temporadas con idc numérico, con partidos finalizados pendientes de acta
  const res = await db.query<{
    season_id: string; idc: string; comp: string; season: string; pending: number;
  }>(`
    SELECT s.id AS season_id, s.source_ref AS idc, c.name AS comp, s.name AS season,
           COUNT(m.id)::int AS pending
    FROM seasons s
    JOIN competitions c ON c.id = s.competition_id
    JOIN matches m ON m.season_id = s.id
    WHERE s.source_ref ~ '^[0-9]+$'
      AND m.status = 'finished'
      AND NOT EXISTS (SELECT 1 FROM match_events e WHERE e.match_id = m.id)
      ${since ? `AND s.start_date >= '${Number(since)}-01-01'` : ''}
      ${org ? `AND c.organizer = '${org.replace(/[^A-Z]/gi, '')}'` : ''}
    GROUP BY s.id, c.name, s.name
    ORDER BY s.start_date DESC NULLS LAST
    ${limit > 0 ? `LIMIT ${limit}` : ''}
  `);

  log.info({ seasons: res.rows.length }, 'Temporadas con actas pendientes');
  let totalPending = res.rows.reduce((a, r) => a + r.pending, 0);
  console.log(`\n▶ ${res.rows.length} temporadas, ~${totalPending} partidos sin acta.\n`);

  let i = 0;
  for (const row of res.rows) {
    i++;
    console.log(`\n[${i}/${res.rows.length}] ${row.comp} ${row.season} — ${row.pending} partidos (idc=${row.idc})`);
    try {
      execSync(
        `npx tsx --env-file=../../.env src/run-pipeline.ts --entity=fichas-pendientes --idc=${row.idc} --season-id=${row.season_id}`,
        { cwd: resolve(HERE, '..'), stdio: 'inherit', timeout: 1_800_000 }
      );
    } catch {
      console.log(`   ⚠️  Falló — continuando con la siguiente temporada`);
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }

  console.log('\n✅ Pasada de actas completada. Relanza cuando quieras: solo procesa lo pendiente.');
}

main()
  .catch((err) => { log.error({ err }, 'Error'); process.exit(1); })
  .finally(() => closeDb());
