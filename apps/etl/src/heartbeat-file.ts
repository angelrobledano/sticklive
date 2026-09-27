/**
 * Latido de fichero del ETL (#146).
 *
 * El contenedor `etl` no expone HTTP: su healthcheck (`deploy/etl-scheduler.sh`)
 * comprueba que `/tmp/etl-alive` se haya tocado en los últimos 45 min. El
 * scheduler lo toca al entrar y salir de cada vuelta, pero `cron-live` puede
 * quedarse hasta 180 min en su PROPIO bucle durante un directo: sin un toque
 * dentro de ese bucle, un ETL OCUPADO se marcaba `unhealthy` (falso positivo), y
 * con el mismo síntoma que un cuelgue real.
 *
 * Tocarlo en cada ciclo del directo hace que el margen refleje *trabajo*: un ETL
 * que avanza toca el latido; uno colgado, no.
 */
import { writeFileSync } from 'node:fs';

export const ETL_ALIVE_FILE = process.env['ETL_ALIVE_FILE'] ?? '/tmp/etl-alive';

/** Toca el fichero de latido. Barato y best-effort: nunca rompe el directo. */
export function touchAlive(file: string = ETL_ALIVE_FILE, now: Date = new Date()): void {
  try {
    writeFileSync(file, String(now.getTime()));
  } catch {
    /* sin /tmp escribible no rompemos el scraping */
  }
}
