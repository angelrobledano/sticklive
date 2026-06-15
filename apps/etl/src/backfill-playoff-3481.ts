/**
 * Backfill manual: competición playoff 3481 (OK Liga playoffs 2025-26)
 *
 * Uso:
 *   npx tsx --env-file=apps/etl/.env apps/etl/src/backfill-playoff-3481.ts
 *
 * Qué hace:
 *   1. Scraping del calendario de la comp 3481 → upsert de partidos con fechas correctas.
 *   2. Por cada partido encontrado con idp, ejecuta FepFichaScraper → eventos/marcadores.
 */
import { db, closeDb, findSportBySlug } from '@sports/db';
import { createLogger } from '@sports/logger';
import { FepCalendarScraper } from '../../scraper/src/scrapers/fep/fep-calendar.scraper.js';
import { FepFichaScraper } from '../../scraper/src/scrapers/fep/fep-ficha.scraper.js';
import { EtlPipeline } from './pipeline.js';

const log = createLogger({ service: 'backfill-playoff-3481' });
const SPORT_SLUG = 'hockey-patines';
const IDC = '3481';

async function main() {
  log.info({ idc: IDC }, 'Iniciando backfill playoff');

  // 1. Buscar la season que corresponde a esta competición
  const seasonRes = await db.query<{ id: string; name: string; competition_id: string }>(
    `SELECT s.id, s.name, s.competition_id
     FROM seasons s
     JOIN competitions c ON c.id = s.competition_id
     WHERE c.source_ref = $1
       AND s.is_current = true
     ORDER BY s.start_date DESC NULLS LAST
     LIMIT 1`,
    [`fep_competition_${IDC}`]
  );

  if (seasonRes.rows.length === 0) {
    log.error({ idc: IDC }, 'No se encontro season para esta competicion. Verifica que este indexada.');
    process.exit(1);
  }

  const season = seasonRes.rows[0]!;
  log.info({ seasonId: season.id, seasonName: season.name }, 'Season encontrada');

  // 2. Scraping del calendario
  const calScraper = new FepCalendarScraper({
    idc: IDC,
    seasonId: season.id,
    competitionName: 'Playoff OK Liga 2025-26',
  });

  const calResult = await calScraper.run();
  log.info({ matches: calResult.data.length }, 'Partidos encontrados en calendario');

  if (calResult.data.length === 0) {
    log.warn('El calendario no devolvio partidos. Puede que la competicion use un endpoint diferente.');
  }

  // 3. ETL de partidos
  const sport = await findSportBySlug(SPORT_SLUG);
  if (!sport) throw new Error(`Deporte no encontrado: ${SPORT_SLUG}`);

  const pipeline = new EtlPipeline({ sportSlug: SPORT_SLUG, seasonId: season.id });
  const etlResult = await pipeline.runMatches(calResult);
  log.info({ upserted: etlResult.upserted, skipped: etlResult.skipped }, 'ETL calendario completado');

  // 4. FepFichaScraper para cada partido con idp
  const matchRows = await db.query<{
    id: string;
    source_ref: string;
    home_team_name: string | null;
    scheduled_at: string | null;
    status: string;
  }>(
    `SELECT m.id, m.source_ref, ht.name AS home_team_name, m.scheduled_at::text, m.status
     FROM matches m
     LEFT JOIN teams ht ON ht.id = m.home_team_id
     WHERE m.season_id = $1
       AND m.source_ref LIKE 'fep_match_%'
     ORDER BY m.scheduled_at ASC`,
    [season.id]
  );

  log.info({ count: matchRows.rows.length }, 'Partidos en DB para esta season');

  for (const match of matchRows.rows) {
    const idp = match.source_ref.replace('fep_match_', '');
    log.info({ idp, status: match.status, scheduledAt: match.scheduled_at }, 'Procesando ficha...');

    try {
      const ficha = new FepFichaScraper({
        idp,
        idc: IDC,
        ...(match.home_team_name ? { homeTeamName: match.home_team_name } : {}),
        matchId: match.id,
      });
      await ficha.run();
      log.info({ idp }, 'Ficha procesada OK');
    } catch (err) {
      log.error({ idp, err }, 'Error procesando ficha');
    }

    // Pausa para no saturar sidgad
    await new Promise(r => setTimeout(r, 1500));
  }

  log.info('Backfill completado');
}

main()
  .catch(err => { log.error({ err }, 'Error fatal'); process.exit(1); })
  .finally(() => closeDb());
