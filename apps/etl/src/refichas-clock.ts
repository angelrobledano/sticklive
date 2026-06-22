/**
 * REFICHAS DE CRONO — re-descarga las actas guardadas ANTES de capturar
 * el tiempo del marcador (match_events.clock) y las reprocesa.
 *
 * Criterio quirúrgico: partidos CON eventos donde NINGÚN evento tiene clock.
 * Los procesados tras el cambio ya lo traen y no se tocan → resumible y
 * sin trabajo redundante. Orden: de reciente a antiguo.
 *
 * Uso:
 *   npx tsx --env-file=../../.env src/refichas-clock.ts            # todo
 *   npx tsx --env-file=../../.env src/refichas-clock.ts --limit=50 # prueba
 */
import './instrument.js'; // Sentry.init — el PRIMERO de todo
import * as Sentry from '@sentry/node';
import { db, closeDb } from '@sports/db';
import { createLogger } from '@sports/logger';
import { FepFichaScraper } from '../../scraper/src/scrapers/fep/fep-ficha.scraper.js';

const log = createLogger({ service: 'refichas-clock' });
const PAUSE_MS = 2_500; // cortesía con la fuente (corre en el VPS)

async function main() {
  const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0);

  const pending = await db.query<{
    id: string; source_ref: string; home_team_name: string | null; comp_ref: string | null;
  }>(`
    SELECT m.id, m.source_ref, ht.name AS home_team_name,
           comp.source_ref AS comp_ref
    FROM matches m
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    JOIN seasons s ON s.id = m.season_id
    JOIN competitions comp ON comp.id = s.competition_id
    WHERE m.source_ref LIKE 'fep_match_%'
      AND EXISTS (SELECT 1 FROM match_events e WHERE e.match_id = m.id)
      AND NOT EXISTS (SELECT 1 FROM match_events e WHERE e.match_id = m.id AND e.clock IS NOT NULL)
    ORDER BY m.scheduled_at DESC
    ${limit > 0 ? `LIMIT ${limit}` : ''}
  `);

  log.info({ total: pending.rows.length }, 'Actas a reprocesar (sin crono)');
  let ok = 0, fail = 0;

  for (const [i, m] of pending.rows.entries()) {
    const idp = m.source_ref.replace(/^fep_match_/, '');
    const idc = (m.comp_ref ?? '').replace(/^fep_competition_/, '');
    try {
      const scraper = new FepFichaScraper({
        idp, idc,
        homeTeamName: m.home_team_name ?? undefined,
        matchId: m.id,
      });
      await scraper.run();
      ok++;
    } catch {
      fail++;
    }
    if ((i + 1) % 25 === 0) {
      log.info({ done: i + 1, total: pending.rows.length, ok, fail }, 'Progreso refichas');
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  log.info({ ok, fail, total: pending.rows.length }, '🏁 Refichas de crono completadas');
}

main()
  .catch((err) => { log.error({ err }, 'Error'); Sentry.captureException(err); process.exitCode = 1; })
  .finally(async () => { await Sentry.flush(2000); await closeDb(); });
