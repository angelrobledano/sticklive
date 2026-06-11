/**
 * Orquestador de scraping en vivo con backoff inteligente.
 *
 * Diseñado para ser invocado por un cron externo cada 5 minutos.
 * El script mismo decide si hay trabajo que hacer:
 *
 *   · Si NO hay partidos live ni empezando en <2 h → sale en <1 s (coste mínimo).
 *   · Si SÍ hay actividad → entra en bucle de polling cada POLL_INTERVAL_S
 *     y no sale hasta que todos los partidos activos sean 'finished'.
 *
 * Uso:
 *   npx tsx --env-file=.env apps/etl/src/cron-live.ts
 *
 * Variables de entorno:
 *   SEASON_ID          — UUID de la temporada activa (requerido)
 *   POLL_INTERVAL_S    — segundos entre ciclos en modo activo (defecto: 45)
 *   WINDOW_HOURS       — horas hacia adelante para buscar partidos próximos (defecto: 2)
 *   MAX_RUNTIME_MIN    — minutos máximos antes de salir por seguridad (defecto: 180)
 */
import { createLogger } from '@sports/logger';
import { db, closeDb } from '@sports/db';
import { EtlPipeline } from './pipeline.js';
import { FepMatchesScraper } from '../../scraper/src/scrapers/fep/fep-matches.scraper.js';
import { snapshotMatches, diffAndNotify, pushEnabled } from './push-dispatcher.js';

const log = createLogger({ service: 'cron-live' });

const SEASON_ID      = process.env['SEASON_ID'] ?? '';
const POLL_INTERVAL  = Number(process.env['POLL_INTERVAL_S']  ?? 45) * 1000;
const WINDOW_HOURS   = Number(process.env['WINDOW_HOURS']     ?? 2);
const MAX_RUNTIME_MS = Number(process.env['MAX_RUNTIME_MIN']  ?? 180) * 60 * 1000;
const SPORT_SLUG     = 'hockey-patines';

interface WindowStatus {
  hasLive:     boolean;  // al menos un partido con status='live'
  hasUpcoming: boolean;  // al menos un partido 'scheduled' en las próximas WINDOW_HOURS
  hasOverdue:  boolean;  // partidos cuya hora ya pasó (últimas 48h) sin estado final
}

/**
 * Consulta rápida: ¿hay actividad en la ventana de tiempo?
 * Dos queries simples con LIMIT 1 — coste mínimo.
 */
async function checkWindow(seasonId: string): Promise<WindowStatus> {
  const [liveRes, upcomingRes, overdueRes] = await Promise.all([
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM matches
       WHERE season_id = $1 AND status = 'live'`,
      [seasonId]
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM matches
       WHERE season_id   = $1
         AND status      = 'scheduled'
         AND scheduled_at BETWEEN NOW() AND NOW() + INTERVAL '${WINDOW_HOURS} hours'`,
      [seasonId]
    ),
    // Partidos zombi: su hora pasó pero siguen sin estado final.
    // Sin esto, un partido cargado como 'scheduled' antes de jugarse
    // nunca recibe su marcador si el cron no coincidió con el directo.
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM matches
       WHERE season_id    = $1
         AND status       IN ('scheduled', 'live')
         AND scheduled_at BETWEEN NOW() - INTERVAL '48 hours' AND NOW()`,
      [seasonId]
    ),
  ]);

  return {
    hasLive:     Number(liveRes.rows[0]?.count ?? 0) > 0,
    hasUpcoming: Number(upcomingRes.rows[0]?.count ?? 0) > 0,
    hasOverdue:  Number(overdueRes.rows[0]?.count ?? 0) > 0,
  };
}

/**
 * Un ciclo de scraping: captura marcadores y los persiste.
 * Devuelve cuántos registros se actualizaron.
 */
async function runOneCycle(seasonId: string): Promise<number> {
  const scraper  = new FepMatchesScraper({ seasonId });
  const pipeline = new EtlPipeline({ sportSlug: SPORT_SLUG, seasonId });

  // Snapshot previo: el dispatcher de push hace diff tras el ciclo
  const prev = pushEnabled ? await snapshotMatches(seasonId) : new Map();

  const result = await scraper.run();
  if (result.data.length === 0) return 0;

  const etl = await pipeline.runMatches(result);

  // Notificar cambios (inicio/gol/final) — nunca rompe el ciclo
  try { await diffAndNotify(prev, seasonId); } catch (err) {
    log.warn({ err }, 'push-dispatcher falló — el scraping sigue');
  }

  return etl.upserted;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!SEASON_ID) {
    log.error('SEASON_ID no configurado. Sal del script.');
    process.exit(1);
  }

  // ── 1. Check de ventana ────────────────────────────────────────────────
  const initial = await checkWindow(SEASON_ID);

  if (!initial.hasLive && !initial.hasUpcoming) {
    if (initial.hasOverdue) {
      // Ciclo único de recuperación: partidos pasados sin resultado final.
      // rfep_mc_1.php incluye los partidos recientes ya finalizados, así que
      // un solo ciclo basta para cerrar marcadores y estados.
      log.info('🩹 Partidos atrasados sin resultado — ciclo de recuperación');
      const upserted = await runOneCycle(SEASON_ID);
      log.info({ upserted }, 'Recuperación completada — saliendo.');
      return;
    }
    log.info(
      { windowHours: WINDOW_HOURS },
      'Sin partidos live ni próximos — saliendo sin trabajo.'
    );
    return; // exit limpio, el cron llamará de nuevo en 5 min
  }

  // ── 2. Modo activo: bucle de polling ───────────────────────────────────
  const startedAt = Date.now();
  log.info(
    { hasLive: initial.hasLive, hasUpcoming: initial.hasUpcoming, pollIntervalS: POLL_INTERVAL / 1000 },
    '⚡ Actividad detectada — iniciando polling'
  );

  let cycle = 0;

  while (true) {
    cycle++;
    const elapsed = Date.now() - startedAt;

    // Guardia de seguridad: no correr más de MAX_RUNTIME_MS
    if (elapsed > MAX_RUNTIME_MS) {
      log.warn({ elapsedMin: Math.round(elapsed / 60_000) }, '⏱ Tiempo máximo alcanzado — saliendo.');
      break;
    }

    // Ejecutar ciclo
    const cycleStart = Date.now();
    try {
      const upserted = await runOneCycle(SEASON_ID);
      log.info(
        { cycle, upserted, durationMs: Date.now() - cycleStart },
        '🔄 Ciclo completado'
      );
    } catch (err) {
      log.error({ cycle, err }, '❌ Error en ciclo — reintentando en siguiente tick');
    }

    // Re-evaluar ventana tras el ciclo
    const status = await checkWindow(SEASON_ID);

    if (!status.hasLive && !status.hasUpcoming) {
      log.info({ cycle }, '✅ Todos los partidos finalizados — saliendo del bucle.');
      break;
    }

    log.debug(
      { hasLive: status.hasLive, hasUpcoming: status.hasUpcoming, nextInMs: POLL_INTERVAL },
      'Próximo ciclo...'
    );
    await sleep(POLL_INTERVAL);
  }

  log.info({ totalCycles: cycle, totalMin: Math.round((Date.now() - startedAt) / 60_000) }, '🏁 Orquestador terminado');
}

main()
  .catch((err) => { log.error({ err }, 'Error fatal'); process.exit(1); })
  .finally(() => closeDb());
