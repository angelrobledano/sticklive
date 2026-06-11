/**
 * Seed inicial para OK Liga Masculina 2025/26.
 *
 * Inserta:
 *  - Competición OK Liga (idc=3150)
 *  - Temporada 2025/26 (temp_39), marcada como is_current
 *  - 14 equipos de la temporada con sus IDs de sidgad como source_ref
 *  - Asociación season_teams
 *
 * Idempotente: usa ON CONFLICT DO NOTHING / DO UPDATE.
 * Imprime los UUIDs generados para usarlos en el ETL.
 *
 * Uso: npx ts-node --esm apps/etl/src/seed-ok-liga.ts
 */
import { db, closeDb } from '@sports/db';
import { createLogger } from '@sports/logger';

const log = createLogger({ service: 'seed' });

// ── Datos conocidos (extraídos de rfep_ls_1.php y competicion_header_creator.php) ──

const SPORT_SLUG = 'hockey-patines';
const SOURCE_SCRAPER_KEY = 'fep_hockey';

const COMPETITION = {
  name: 'OK LIGA MASCULINA',
  shortName: 'OK Liga',
  slug: 'ok-liga-masculina',
  gender: 'male' as const,
  category: 'senior',
  country: 'ES',
  sourceRef: '3150',        // idc sidgad
};

const SEASON = {
  name: '2025/26',
  slug: '2025-26',
  startDate: '2024-09-01',
  endDate: '2025-06-30',
  sourceRef: 'temp_39',     // temp_39 en sidgad
};

// Equipos: [sidgad_team_id, nombre_completo, abreviatura, ciudad]
// Fuente: teams_array de competicion_header_creator.php + standings
const TEAMS: Array<{ ref: string; name: string; shortName: string; slug: string; city?: string }> = [
  { ref: '3373', name: 'HOCKEY CLUB LICEO',               shortName: 'HCL',  slug: 'hockey-club-liceo',               city: 'A Coruña' },
  { ref: '3358', name: 'BARÇA',                           shortName: 'BAR',  slug: 'barca',                           city: 'Barcelona' },
  { ref: '3408', name: 'IGUALADA RIGAT HC',               shortName: 'IHC',  slug: 'igualada-rigat-hc',               city: 'Igualada' },
  { ref: '3359', name: 'CALAFELL LA MENORQUINA',          shortName: 'CAL',  slug: 'calafell-la-menorquina',          city: 'Calafell' },
  { ref: '3332', name: 'REUS DEPORTIU BRASILIA',          shortName: 'REUS', slug: 'reus-deportiu-brasilia',          city: 'Reus' },
  { ref: '3412', name: 'CP VOLTREGA MOVENTO STERN',       shortName: 'CPV',  slug: 'cp-voltrega-movento-stern',       city: 'Les Masies de Voltregà' },
  { ref: '3387', name: 'CE NOIA FREIXENET',               shortName: 'NOIA', slug: 'ce-noia-freixenet',               city: 'Noia' },
  { ref: '3411', name: 'PONS LLEIDA',                     shortName: 'LLE',  slug: 'pons-lleida',                     city: 'Lleida' },
  { ref: '3363', name: 'AITEX PAS ALCOI',                 shortName: 'PAS',  slug: 'aitex-pas-alcoi',                 city: 'Alcoi' },
  { ref: '3374', name: 'ADISS HOCKEY RIVAS',              shortName: 'RIV',  slug: 'adiss-hockey-rivas',              city: 'Rivas-Vaciamadrid' },
  { ref: '3336', name: 'SHUM FRIT RAVICH',                shortName: 'SHUM', slug: 'shum-frit-ravich',               city: 'Vic' },
  { ref: '3337', name: 'CH CALDES RECAM LÀSER',           shortName: 'CHC',  slug: 'ch-caldes-recam-laser',          city: 'Caldes de Malavella' },
  { ref: '3350', name: 'INNOAESTHETICS HC SANT JUST',     shortName: 'HCSJ', slug: 'innoaesthetics-hc-sant-just',    city: 'Sant Just Desvern' },
  { ref: '3361', name: "CERDANYOLA CLUB D'HOQUEI",        shortName: 'CCH',  slug: 'cerdanyola-club-dhoquei',        city: 'Cerdanyola del Vallès' },
];

async function seed() {
  // ── Obtener IDs de referencia ────────────────────────────────
  const sportRes = await db.query<{ id: string }>(
    `SELECT id FROM sports WHERE slug = $1`, [SPORT_SLUG]
  );
  if (!sportRes.rows[0]) throw new Error(`Deporte no encontrado: ${SPORT_SLUG}`);
  const sportId = sportRes.rows[0].id;

  const sourceRes = await db.query<{ id: string }>(
    `SELECT id FROM data_sources WHERE scraper_key = $1`, [SOURCE_SCRAPER_KEY]
  );
  if (!sourceRes.rows[0]) throw new Error(`DataSource no encontrado: ${SOURCE_SCRAPER_KEY}`);
  const sourceId = sourceRes.rows[0].id;

  log.info({ sportId, sourceId }, 'IDs base encontrados');

  // ── Competición ──────────────────────────────────────────────
  const compRes = await db.query<{ id: string }>(
    `INSERT INTO competitions
       (sport_id, name, short_name, slug, gender, category, country, source_id, source_ref, scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (sport_id, slug) DO UPDATE SET
       name = EXCLUDED.name,
       source_ref = EXCLUDED.source_ref,
       updated_at = NOW()
     RETURNING id`,
    [sportId, COMPETITION.name, COMPETITION.shortName, COMPETITION.slug,
     COMPETITION.gender, COMPETITION.category, COMPETITION.country,
     sourceId, COMPETITION.sourceRef]
  );
  const competitionId = compRes.rows[0]!.id;
  log.info({ competitionId, name: COMPETITION.name }, '✅ Competición');

  // ── Temporada ────────────────────────────────────────────────
  // Desactivar otras temporadas de esta competición primero
  await db.query(
    `UPDATE seasons SET is_current = FALSE WHERE competition_id = $1`, [competitionId]
  );
  const seasonRes = await db.query<{ id: string }>(
    `INSERT INTO seasons
       (competition_id, name, slug, start_date, end_date, is_current, source_id, source_ref, scraped_at)
     VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7,NOW())
     ON CONFLICT (competition_id, slug) DO UPDATE SET
       is_current = TRUE,
       source_ref = EXCLUDED.source_ref,
       updated_at = NOW()
     RETURNING id`,
    [competitionId, SEASON.name, SEASON.slug, SEASON.startDate, SEASON.endDate,
     sourceId, SEASON.sourceRef]
  );
  const seasonId = seasonRes.rows[0]!.id;
  log.info({ seasonId, name: SEASON.name }, '✅ Temporada');

  // ── Equipos ──────────────────────────────────────────────────
  for (const team of TEAMS) {
    const teamRes = await db.query<{ id: string }>(
      `INSERT INTO teams
         (sport_id, name, short_name, slug, city, country, source_id, source_ref, scraped_at)
       VALUES ($1,$2,$3,$4,$5,'ES',$6,$7,NOW())
       ON CONFLICT (sport_id, slug) DO UPDATE SET
         name = EXCLUDED.name,
         short_name = EXCLUDED.short_name,
         source_ref = EXCLUDED.source_ref,
         updated_at = NOW()
       RETURNING id`,
      [sportId, team.name, team.shortName, team.slug, team.city ?? null, sourceId, team.ref]
    );
    const teamId = teamRes.rows[0]!.id;

    // Asociar equipo a la temporada
    await db.query(
      `INSERT INTO season_teams (season_id, team_id)
       VALUES ($1,$2)
       ON CONFLICT (season_id, team_id) DO NOTHING`,
      [seasonId, teamId]
    );
  }
  log.info({ count: TEAMS.length }, '✅ Equipos insertados y asociados a la temporada');

  // ── Resumen ──────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════');
  console.log('✅ SEED COMPLETADO');
  console.log('══════════════════════════════════════════════');
  console.log(`COMPETITION_ID=${competitionId}`);
  console.log(`SEASON_ID=${seasonId}`);
  console.log(`SPORT_ID=${sportId}`);
  console.log(`SOURCE_ID=${sourceId}`);
  console.log('══════════════════════════════════════════════');
  console.log('\nCopia el SEASON_ID y úsalo en el runner ETL:');
  console.log(`  DEFAULT_SEASON_ID=${seasonId}`);
}

seed()
  .catch((err) => { log.error({ err }, 'Error en seed'); process.exit(1); })
  .finally(() => closeDb());
