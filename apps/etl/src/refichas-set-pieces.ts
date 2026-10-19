/**
 * REFICHAS DE BALÓN PARADO (C1) — re-descarga y reprocesa las actas guardadas
 * antes de leer el lanzador y el resultado de penaltis y faltas directas.
 *
 * Auditoría del 19/10/2026 (OK Liga Plata Sur 2025/26, 268 acciones contra las
 * actas originales): el resultado era correcto en 265, pero los fallos llegaban
 * sin lanzador (186 de 189) y 3 faltas directas falladas constaban como gol.
 * La misma pasada corrige el reparto nombre/apellidos de los jugadores del
 * partido (ver fixPlayerNameSplit).
 *
 * Criterio: partidos de la FEP con algún penalti o falta directa sin jugador.
 * Los ya reprocesados traen al lanzador y no vuelven a salir → resumible.
 * Orden: de reciente a antiguo.
 *
 * Uso (producción, ver docs/DEPLOY.md):
 *   $DC exec etl node dist/apps/etl/src/refichas-set-pieces.js --dry-run
 *   $DC exec etl node dist/apps/etl/src/refichas-set-pieces.js --season-id=<uuid> --limit=20
 *   $DC exec etl node dist/apps/etl/src/refichas-set-pieces.js
 */
import './instrument.js'; // Sentry.init — el PRIMERO de todo
import * as Sentry from '@sentry/node';
import { db, closeDb } from '@sports/db';
import { createLogger } from '@sports/logger';
import { FepFichaScraper } from '../../scraper/src/scrapers/fep/fep-ficha.scraper.js';

const log = createLogger({ service: 'refichas-set-pieces' });
const PAUSE_MS = 2_500; // cortesía con la fuente

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

async function main() {
  const limit = Number(arg('limit') ?? 0);
  const seasonId = arg('season-id') ?? null;
  const dryRun = process.argv.includes('--dry-run');
  if (!Number.isInteger(limit) || limit < 0) throw new Error('--limit debe ser un entero ≥ 0');

  const pending = await db.query<{
    id: string; source_ref: string; home_team_name: string | null; comp_ref: string | null;
  }>(`
    SELECT m.id, m.source_ref, ht.name AS home_team_name, comp.source_ref AS comp_ref
      FROM matches m
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      JOIN seasons s ON s.id = m.season_id
      JOIN competitions comp ON comp.id = s.competition_id
     WHERE m.source_ref LIKE 'fep_match_%'
       AND m.status = 'finished'
       AND ($1::uuid IS NULL OR m.season_id = $1::uuid)
       AND EXISTS (
         SELECT 1 FROM match_events e
          WHERE e.match_id = m.id
            AND e.event_type IN ('penalty', 'direct_foul')
            AND e.player_id IS NULL)
     ORDER BY m.scheduled_at DESC
     ${limit > 0 ? `LIMIT ${limit}` : ''}
  `, [seasonId]);

  log.info({ total: pending.rows.length, seasonId, dryRun }, 'Actas a reprocesar (balón parado sin lanzador)');
  if (dryRun) return;

  let ok = 0, fail = 0;
  for (const [i, m] of pending.rows.entries()) {
    const idp = m.source_ref.replace(/^fep_match_/, '');
    const idc = (m.comp_ref ?? '').replace(/^fep_competition_/, '');
    try {
      await new FepFichaScraper({ idp, idc, homeTeamName: m.home_team_name ?? undefined, matchId: m.id }).run();
      ok++;
    } catch (err) {
      fail++;
      log.warn({ err, matchId: m.id, idp }, 'No se pudo reprocesar el acta');
    }
    if ((i + 1) % 25 === 0) log.info({ done: i + 1, total: pending.rows.length, ok, fail }, 'Progreso');
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  log.info({ ok, fail, total: pending.rows.length }, 'Refichas de balón parado completadas');
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((err) => { log.error({ err }, 'Error'); Sentry.captureException(err); process.exitCode = 1; })
  .finally(async () => { await Sentry.flush(2000); await closeDb(); });
