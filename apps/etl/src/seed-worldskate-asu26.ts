/**
 * Seed de las 4 competiciones de rink hockey de los World Skate Games
 * Asunción 2026 (portal sidgad 'worldskate', temporada temp_41 = 2026/27).
 *
 * Competiciones (idc sidgad verificados en worldskate_ls_1.php):
 *   - 325 WORLD CHAMPIONSHIP MEN        → Mundial Masculino (M senior, 8)
 *   - 329 WORLD CHAMPIONSHIP WOMEN      → Mundial Femenino (F senior, 11)
 *   - 330 WORLD INTERCONTINETAL MEN     → Intercontinental Masculino (M senior, 9)
 *   - 331 WORLD U19 MEN                 → Mundial Sub-19 Masculino (M sub19, 8)
 *
 * Crea:
 *  - Competición (scope internacional, organizador World Skate) + temporada
 *    "WSG Asunción 2026" con timezone de la sede (America/Asuncion, UTC-4
 *    permanente) y VENTANAS reales de cada torneo (la guarda #229 y la
 *    ventana del scraper dependen de ellas).
 *  - Las 36 selecciones nacionales (team_type='national') con ref namespaced
 *    'wse_<idSidgad>' (ids portal-globales de sidgad; los de ASU26 1130-1169
 *    no colisionan con los sembrados por los seeds WSE 1116-1129) y escudo.
 *  - season_teams con group_name según los grupos oficiales del sorteo
 *    (config_params.groups_ids del portal).
 *  - competition_sources con el idc y el formato declarado.
 *
 * El formato (rondas/fases) NO se seedea: lo emite el scraper como datos
 * (salida `rounds`) y lo crea el ETL — incluidas las eliminatorias cuyos
 * participantes publica la fuente más tarde. Los partidos no se seedean.
 *
 * Idempotente (ON CONFLICT). Uso:
 *   npx tsx apps/etl/src/seed-worldskate-asu26.ts
 *
 * Formato documentado en docs/audit-wsg-asu26.md (reglamento WSG 2024 +
 * noticias oficiales 2026 + portal de resultados).
 */
import { db, closeDb } from '@sports/db';
import { createLogger } from '@sports/logger';

const log = createLogger({ service: 'seed-wsg-asu26' });

const SPORT_SLUG = 'hockey-patines';
const SOURCE_SCRAPER_KEY = 'worldskate_hockey';
const LOGO_BASE = 'https://sidgad.cloud/worldskate/images/logos_clubes/';
const SITE_URL = (idc: string) => `https://www.rinkhockey.worldskate.org/league/${idc}`;

/** [idSidgad, país ISO, nombre ES, abreviatura, escudo, grupo] */
type TeamSeed = [string, string, string, string, string, 'A' | 'B'];

interface CompetitionSeed {
  idc: string;
  name: string;
  shortName: string;
  slug: string;
  gender: 'male' | 'female';
  /** categoría en el modelo: senior | sub19 (texto libre en competitions.category) */
  category: string;
  /** age_category de competitions: el CHECK solo admite 'base' para inferiores */
  compAgeCategory: 'senior' | 'base';
  /** age_category de teams (texto libre) */
  teamAgeCategory: string;
  startDate: string;
  endDate: string;
  teams: TeamSeed[];
}

const COMPETITIONS: CompetitionSeed[] = [
  {
    idc: '325',
    name: 'Mundial Masculino — World Skate',
    shortName: 'Mundial M',
    slug: 'mundial-masculino-worldskate',
    gender: 'male',
    category: 'senior',
    compAgeCategory: 'senior',
    teamAgeCategory: 'senior',
    startDate: '2026-10-12',
    endDate: '2026-10-18',
    teams: [
      ['1168', 'CH', 'Suiza',       'SUI', '13_1', 'A'],
      ['1132', 'PT', 'Portugal',    'POR', '12_1', 'A'],
      ['1134', 'IT', 'Italia',      'ITA', '10_1', 'A'],
      ['1130', 'ES', 'España',      'ESP', '8_2',  'A'],
      ['1131', 'CL', 'Chile',       'CHI', '40',   'B'],
      ['1133', 'FR', 'Francia',     'FRA', '11_1', 'B'],
      ['1135', 'AO', 'Angola',      'ANG', '9_1',  'B'],
      ['1136', 'AR', 'Argentina',   'ARG', '14_1', 'B'],
    ],
  },
  {
    idc: '329',
    name: 'Mundial Femenino — World Skate',
    shortName: 'Mundial F',
    slug: 'mundial-femenino-worldskate',
    gender: 'female',
    category: 'senior',
    compAgeCategory: 'senior',
    teamAgeCategory: 'senior',
    startDate: '2026-10-04',
    endDate: '2026-10-10',
    teams: [
      ['1146', 'CH', 'Suiza',       'SUI', '13_1', 'A'],
      ['1144', 'FR', 'Francia',     'FRA', '11_1', 'A'],
      ['1142', 'CL', 'Chile',       'CHI', '40',   'A'],
      ['1140', 'AR', 'Argentina',   'ARG', '14_1', 'A'],
      ['1138', 'ES', 'España',      'ESP', '8_2',  'A'],
      ['1148', 'MX', 'México',      'MEX', '25',   'B'],
      ['1147', 'BR', 'Brasil',      'BRA', '22',   'B'],
      ['1145', 'IN', 'India',       'IND', '33_1', 'B'],
      ['1143', 'CO', 'Colombia',    'COL', '19_1', 'B'],
      ['1141', 'IT', 'Italia',      'ITA', '10_1', 'B'],
      ['1139', 'PT', 'Portugal',    'POR', '12_1', 'B'],
    ],
  },
  {
    idc: '330',
    name: 'Intercontinental Masculino — World Skate',
    shortName: 'Intercontinental M',
    slug: 'intercontinental-masculino-worldskate',
    gender: 'male',
    category: 'senior',
    compAgeCategory: 'senior',
    teamAgeCategory: 'senior',
    startDate: '2026-10-11',
    endDate: '2026-10-18',
    teams: [
      ['1152', 'AT', 'Austria',     'AUT', '50',   'A'],
      ['1158', 'MX', 'México',      'MEX', '25',   'A'],
      ['1156', 'IN', 'India',       'IND', '33_1', 'A'],
      ['1169', 'MZ', 'Mozambique',  'MOZ', '43',   'A'],
      ['1157', 'AU', 'Australia',   'AUS', '36',   'B'],
      ['1155', 'ZA', 'Sudáfrica',   'RSA', '85_1', 'B'],
      ['1154', 'EG', 'Egipto',      'EGY', '41',   'B'],
      ['1151', 'BR', 'Brasil',      'BRA', '22',   'B'],
      ['1150', 'CO', 'Colombia',    'COL', '19_1', 'B'],
    ],
  },
  {
    idc: '331',
    name: 'Mundial Sub-19 Masculino — World Skate',
    shortName: 'Mundial Sub-19 M',
    slug: 'mundial-sub19-masculino-worldskate',
    gender: 'male',
    category: 'sub19',
    compAgeCategory: 'base',
    teamAgeCategory: 'sub19',
    startDate: '2026-10-04',
    endDate: '2026-10-10',
    teams: [
      ['1165', 'CH', 'Suiza',       'SUI', '13_1', 'A'],
      ['1163', 'IT', 'Italia',      'ITA', '10_1', 'A'],
      ['1161', 'AR', 'Argentina',   'ARG', '14_1', 'A'],
      ['1159', 'ES', 'España',      'ESP', '8_2',  'A'],
      ['1166', 'IN', 'India',       'IND', '33_1', 'B'],
      ['1164', 'CO', 'Colombia',    'COL', '19_1', 'B'],
      ['1162', 'FR', 'Francia',     'FRA', '11_1', 'B'],
      ['1160', 'PT', 'Portugal',    'POR', '12_1', 'B'],
    ],
  },
];

/** slug único por país+categoría+género, para no colisionar con futuras selecciones del mismo país. */
function teamSlug(country: string, ageCategory: string, gender: string): string {
  const cat = gender === 'female' ? 'f' : 'm';
  return `seleccion-${country.toLowerCase().replace(/[^a-z]/g, '-')}-${ageCategory}-${cat}`;
}

async function seedCompetition(
  seed: CompetitionSeed,
  ctx: { sportId: string; sourceId: string }
): Promise<void> {
  const { idc } = seed;
  const compRef = `wse_competition_${idc}`;
  const seasonRef = `wse_season_${idc}`;

  // ── Competición ──────────────────────────────────────────────
  // La competición es la entidad durable (una por concepto); la edición vive
  // en la temporada. source_ref 'wse_competition_<idc>' es lo que el pipeline
  // World Skate (resolveWorldskate) descubre para scrapear cada idc.
  const compRes = await db.query<{ id: string }>(
    `INSERT INTO competitions
       (sport_id, name, short_name, slug, gender, category, country, scope, organizer, age_category, source_id, source_ref, scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,'W','international','World Skate',$7,$8,$9,NOW())
     ON CONFLICT (sport_id, slug) DO UPDATE SET
       name = EXCLUDED.name,
       short_name = EXCLUDED.short_name,
       gender = EXCLUDED.gender,
       category = EXCLUDED.category,
       scope = 'international',
       organizer = 'World Skate',
       source_ref = EXCLUDED.source_ref,
       updated_at = NOW()
     RETURNING id`,
    [ctx.sportId, seed.name, seed.shortName, seed.slug, seed.gender, seed.category,
     seed.compAgeCategory, ctx.sourceId, compRef]
  );
  const competitionId = compRes.rows[0]!.id;
  log.info({ idc, competitionId, name: seed.name }, '✅ Competición');

  // ── Temporada (edición) ──────────────────────────────────────
  await db.query(
    `UPDATE seasons SET is_current = FALSE WHERE competition_id = $1`, [competitionId]
  );
  const seasonRes = await db.query<{ id: string }>(
    `INSERT INTO seasons
       (competition_id, name, slug, start_date, end_date, is_current, timezone, source_id, source_ref, scraped_at)
     VALUES ($1,$2,'wsg-asuncion-2026',$3,$4,TRUE,'America/Asuncion',$5,$6,NOW())
     ON CONFLICT (competition_id, slug) DO UPDATE SET
       is_current = TRUE,
       name = EXCLUDED.name,
       start_date = EXCLUDED.start_date,
       end_date = EXCLUDED.end_date,
       timezone = EXCLUDED.timezone,
       source_ref = EXCLUDED.source_ref,
       updated_at = NOW()
     RETURNING id`,
    [competitionId, 'WSG Asunción 2026', seed.startDate, seed.endDate, ctx.sourceId, seasonRef]
  );
  const seasonId = seasonRes.rows[0]!.id;
  log.info({ idc, seasonId, ventana: `${seed.startDate} → ${seed.endDate}` }, '✅ Temporada');

  // ── Selecciones + grupos ─────────────────────────────────────
  for (const [sidgadId, country, name, shortName, logo, group] of seed.teams) {
    const ref = `wse_${sidgadId}`;
    const slug = teamSlug(country, seed.teamAgeCategory, seed.gender);
    const logoUrl = `${LOGO_BASE}${logo}.png`;

    const teamRes = await db.query<{ id: string }>(
      `INSERT INTO teams
         (sport_id, name, short_name, slug, country, logo_url,
          team_type, gender, age_category,
          source_id, source_ref, alt_source_refs, scraped_at)
       VALUES ($1,$2,$3,$4,$5,$6,'national',$7,$8,$9,$10,$11,NOW())
       ON CONFLICT (sport_id, slug) DO UPDATE SET
         name = EXCLUDED.name,
         short_name = EXCLUDED.short_name,
         logo_url = EXCLUDED.logo_url,
         team_type = 'national',
         gender = EXCLUDED.gender,
         age_category = EXCLUDED.age_category,
         source_ref = EXCLUDED.source_ref,
         updated_at = NOW()
       RETURNING id`,
      [ctx.sportId, name, shortName, slug, country, logoUrl,
       seed.gender, seed.teamAgeCategory, ctx.sourceId, ref, [sidgadId]]
    );
    const teamId = teamRes.rows[0]!.id;

    // season_teams con GRUPO OFICIAL (el sorteo es dato, no inferencia).
    await db.query(
      `INSERT INTO season_teams (season_id, team_id, group_name)
       VALUES ($1,$2,$3)
       ON CONFLICT (season_id, team_id) DO UPDATE SET group_name = EXCLUDED.group_name`,
      [seasonId, teamId, group]
    );
  }
  log.info({ idc, equipos: seed.teams.length }, '✅ Selecciones con grupos');

  // ── competition_sources: idc + formato declarado ─────────────
  await db.query(
    `INSERT INTO competition_sources (competition_id, source_id, external_ids)
     VALUES ($1,$2,$3)
     ON CONFLICT (competition_id) DO UPDATE SET
       source_id = EXCLUDED.source_id,
       external_ids = EXCLUDED.external_ids,
       is_active = TRUE,
       updated_at = NOW()`,
    [competitionId, ctx.sourceId, JSON.stringify({
      idc,
      temp: '41',
      format: 'bracket',
      source_url: SITE_URL(idc),
    })]
  );
  log.info({ idc }, '✅ competition_sources');
}

async function seed() {
  const sportRes = await db.query<{ id: string }>(
    `SELECT id FROM sports WHERE slug = $1`, [SPORT_SLUG]
  );
  if (!sportRes.rows[0]) throw new Error(`Deporte no encontrado: ${SPORT_SLUG}`);
  const sportId = sportRes.rows[0].id;

  const sourceRes = await db.query<{ id: string }>(
    `SELECT id FROM data_sources WHERE scraper_key = $1`, [SOURCE_SCRAPER_KEY]
  );
  if (!sourceRes.rows[0]) {
    throw new Error(
      `DataSource no encontrado: ${SOURCE_SCRAPER_KEY}. ` +
      '¿Se aplicó la migración 032 (que registra la fuente worldskate)?'
    );
  }
  const sourceId = sourceRes.rows[0].id;
  log.info({ sportId, sourceId }, 'IDs base encontrados');

  for (const comp of COMPETITIONS) {
    await seedCompetition(comp, { sportId, sourceId });
  }

  console.log('\n══════════════════════════════════════════════');
  console.log('✅ SEED WSG ASUNCIÓN 2026 COMPLETADO');
  console.log('══════════════════════════════════════════════');
  console.log('Competiciones: 325 (Mundial M), 329 (Mundial F), 330 (Intercontinental M), 331 (Sub-19 M)');
  console.log(`SPORT_ID=${sportId}`);
  console.log(`SOURCE_ID=${sourceId}`);
  console.log('Siguiente paso: --run-once worldskate (scraper) para importar calendario+clasificación+rondas');
  console.log('══════════════════════════════════════════════');
}

seed()
  .catch((err) => { log.error({ err }, 'Error en seed'); process.exit(1); })
  .finally(() => closeDb());
