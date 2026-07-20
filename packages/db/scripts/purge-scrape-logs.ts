/**
 * Purga de `scrape_logs`.
 *
 * Esa tabla es un registro de auditoría del scraping: cada loader escribe una
 * fila por ejecución (partidos, clasificaciones, competiciones). Crece sin
 * límite y **nadie la lee**: `getLastScrapeLog` existe en packages/db pero no
 * tiene un solo consumidor en todo el repo.
 *
 * Con el planificador actual son del orden de mil filas al día — cuatro por
 * ciclo de World Skate cada 5 minutos, más las que añade `cron-live` en sus
 * bucles de 45 s durante los partidos.
 *
 * Se borra por lotes en vez de un DELETE único: sobre una tabla grande, un
 * borrado masivo mantiene un lock largo y hace crecer el WAL de golpe.
 *
 * Uso:
 *   npx tsx packages/db/scripts/purge-scrape-logs.ts
 *
 * Variables de entorno:
 *   SCRAPE_LOGS_RETENTION_DAYS — días a conservar (defecto: 30)
 *   SCRAPE_LOGS_PURGE_BATCH    — filas por lote (defecto: 10000)
 */
import { db, closeDb } from '../src/index.js';

const RETENTION_DAYS = Number(process.env['SCRAPE_LOGS_RETENTION_DAYS'] ?? 30);
const BATCH = Number(process.env['SCRAPE_LOGS_PURGE_BATCH'] ?? 10_000);

async function main() {
  if (!Number.isFinite(RETENTION_DAYS) || RETENTION_DAYS < 1) {
    throw new Error(`SCRAPE_LOGS_RETENTION_DAYS inválido: ${process.env['SCRAPE_LOGS_RETENTION_DAYS']}`);
  }

  const antes = await db.query<{ total: string; viejas: string; mas_antigua: string | null }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE scraped_at < NOW() - make_interval(days => $1::int))::text AS viejas,
            MIN(scraped_at)::text AS mas_antigua
       FROM scrape_logs`,
    [RETENTION_DAYS]
  );
  const { total, viejas, mas_antigua } = antes.rows[0]!;

  console.log(`scrape_logs: ${total} filas, la más antigua de ${mas_antigua ?? '—'}`);
  console.log(`A purgar (> ${RETENTION_DAYS} días): ${viejas}`);

  if (Number(viejas) === 0) {
    console.log('Nada que purgar.');
    return;
  }

  let borradas = 0;
  for (;;) {
    // ctid en el subselect: evita ordenar y va directo a las filas elegidas.
    const res = await db.query(
      `DELETE FROM scrape_logs
        WHERE ctid IN (
          SELECT ctid FROM scrape_logs
           WHERE scraped_at < NOW() - make_interval(days => $1::int)
           LIMIT $2
        )`,
      [RETENTION_DAYS, BATCH]
    );
    const n = res.rowCount ?? 0;
    borradas += n;
    if (n > 0) console.log(`  … ${borradas} borradas`);
    if (n < BATCH) break;
  }

  console.log(`✅ ${borradas} filas purgadas; se conservan los últimos ${RETENTION_DAYS} días.`);
}

main()
  .catch((err) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
