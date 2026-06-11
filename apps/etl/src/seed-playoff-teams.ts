/**
 * Asocia los 10 equipos clasificados al playoff (idc=3481) con su temporada.
 *
 * La competición y temporada del playoff ya existen (migración 004).
 * Lo que faltaba era la capa season_teams: sin ella el ETL no puede
 * resolver equipos al cargar el calendario del playoff.
 *
 * IDs de equipo extraídos de rfep_ls_1.php (config_params.ids_teams del
 * elemento idc 3481): coinciden con los source_ref ya sembrados por
 * seed-ok-liga.ts, así que solo creamos las asociaciones.
 *
 * Idempotente. Uso:
 *   npx tsx --env-file=.env apps/etl/src/seed-playoff-teams.ts
 */
import { db, closeDb } from '@sports/db';
import { createLogger } from '@sports/logger';

const log = createLogger({ service: 'seed-playoff-teams' });

const PLAYOFF_COMPETITION_REF = 'fep_competition_3481';

// ids_teams del playoff en sidgad (= source_ref en teams)
const PLAYOFF_TEAM_REFS = [
  '3358', // BARÇA
  '3359', // CALAFELL LA MENORQUINA
  '3332', // REUS DEPORTIU BRASILIA
  '3387', // CE NOIA FREIXENET
  '3408', // IGUALADA RIGAT HC
  '3412', // CP VOLTREGA MOVENTO STERN
  '3373', // HOCKEY CLUB LICEO
  '3411', // PONS LLEIDA
  '3363', // AITEX PAS ALCOI
  '3374', // ADISS HOCKEY RIVAS
];

async function seed() {
  // Temporada actual del playoff
  const seasonRes = await db.query<{ id: string; name: string }>(
    `SELECT s.id, s.name
     FROM seasons s
     JOIN competitions c ON c.id = s.competition_id
     WHERE c.source_ref = $1 AND s.is_current = TRUE`,
    [PLAYOFF_COMPETITION_REF]
  );
  if (!seasonRes.rows[0]) {
    throw new Error(
      `No existe temporada current para ${PLAYOFF_COMPETITION_REF}. ` +
      `¿Has aplicado la migración 004_playoff_competition.sql?`
    );
  }
  const seasonId = seasonRes.rows[0].id;
  log.info({ seasonId, season: seasonRes.rows[0].name }, 'Temporada playoff encontrada');

  let linked = 0;
  const missing: string[] = [];

  for (const ref of PLAYOFF_TEAM_REFS) {
    const teamRes = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM teams WHERE source_ref = $1`,
      [ref]
    );
    if (!teamRes.rows[0]) {
      missing.push(ref);
      continue;
    }
    await db.query(
      `INSERT INTO season_teams (season_id, team_id)
       VALUES ($1, $2)
       ON CONFLICT (season_id, team_id) DO NOTHING`,
      [seasonId, teamRes.rows[0].id]
    );
    linked++;
    log.info({ ref, team: teamRes.rows[0].name }, '✅ Asociado');
  }

  if (missing.length > 0) {
    log.warn({ missing }, '⚠️  Equipos no encontrados — ejecuta antes seed-ok-liga.ts');
  }

  console.log('\n══════════════════════════════════════════════');
  console.log(`✅ ${linked}/${PLAYOFF_TEAM_REFS.length} equipos asociados al playoff`);
  console.log(`PLAYOFF_SEASON_ID=${seasonId}`);
  console.log('══════════════════════════════════════════════');
  console.log('\nSiguiente paso — cargar el calendario del playoff:');
  console.log(`  npx tsx --env-file=.env apps/etl/src/run-pipeline.ts --entity=calendar --idc=3481 --season-id=${seasonId}`);
}

seed()
  .catch((err) => { log.error({ err }, 'Error en seed'); process.exit(1); })
  .finally(() => closeDb());
