/**
 * Seed del Campeonato de Europa Sub-17 Masculino (World Skate Europe).
 * Edición 2025/26 — Braga (Portugal), 20-25 julio 2026, idc sidgad 320.
 *
 * Crea:
 *  - Competición (scope internacional, WSE) y su temporada 2025/26 con
 *    timezone de la sede (Europe/Lisbon).
 *  - Las 8 selecciones nacionales (team_type='national', género M, sub17),
 *    con su ref namespaced 'wse_<idSidgad>' y el escudo (bandera).
 *  - Asociación season_teams.
 *
 * Los partidos/rondas/clasificaciones NO se seedean aquí: los trae el
 * scraper (M4). Este seed es el prerequisito para que el ETL resuelva los
 * equipos por source_ref.
 *
 * Contrato de refs para el scraper M4 (la resolución del ETL es global,
 * sin scope por fuente → namespaceamos con 'wse_' para evitar colisiones
 * con la FEP y futuras autonómicas):
 *   - Calendario/eliminatorias (filas team_XXXX): emitir ref 'wse_<XXXX>'.
 *   - Clasificaciones (solo nombre+bandera): mapear nombre→idSidgad con el
 *     propio calendario del scrape y emitir también 'wse_<XXXX>'.
 * El id crudo se guarda además en alt_source_refs como red de seguridad.
 *
 * Idempotente (ON CONFLICT). Uso:
 *   npx tsx apps/etl/src/seed-worldskate-u17.ts
 */
import { db, closeDb } from '@sports/db';
import { createLogger } from '@sports/logger';

const log = createLogger({ service: 'seed-wse' });

const SPORT_SLUG = 'hockey-patines';
const SOURCE_SCRAPER_KEY = 'worldskate_hockey';
const LOGO_BASE = 'https://www.sidgad.com/worldskate/images/logos_clubes/';

const COMPETITION = {
  name: 'Campeonato de Europa Sub-17 Masculino',
  shortName: 'Europeo Sub-17 M',
  slug: 'europeo-sub-17-masculino',
  gender: 'male' as const,
  category: 'sub17',      // texto libre (competitions.category)
  country: 'EU',          // internacional (no un único país)
  sourceRef: 'wse_competition_320',
};

const SEASON = {
  name: '2025/26',
  slug: '2025-26',
  startDate: '2026-07-20',
  endDate: '2026-07-25',
  timezone: 'Europe/Lisbon',   // sede: Braga (Portugal)
  sourceRef: 'wse_season_320',
};

// Selecciones (edición 2026, idc 320). [idSidgad, país ISO, nombre ES, abrev, logo]
// idSidgad y logo extraídos del calendario worldskate_cal_idc_320_1.php.
const TEAMS: Array<{
  sidgadId: string; country: string; name: string; shortName: string; logo: string;
}> = [
  { sidgadId: '1117', country: 'ES',     name: 'España',      shortName: 'ESP', logo: '8_1' },
  { sidgadId: '1116', country: 'PT',     name: 'Portugal',    shortName: 'POR', logo: '12'  },
  { sidgadId: '1118', country: 'IT',     name: 'Italia',      shortName: 'ITA', logo: '10'  },
  { sidgadId: '1119', country: 'FR',     name: 'Francia',     shortName: 'FRA', logo: '11'  },
  { sidgadId: '1120', country: 'DE',     name: 'Alemania',    shortName: 'GER', logo: '27'  },
  { sidgadId: '1121', country: 'GB-ENG', name: 'Inglaterra',  shortName: 'ENG', logo: '42'  },
  { sidgadId: '1122', country: 'CH',     name: 'Suiza',       shortName: 'SUI', logo: '13'  },
  { sidgadId: '1123', country: 'AD',     name: 'Andorra',     shortName: 'AND', logo: '44'  },
];

const GENDER = 'male';
const AGE_CATEGORY = 'sub17';

/** slug único por país+categoría+género, para no colisionar con futuras selecciones del mismo país. */
function teamSlug(country: string): string {
  return `seleccion-${country.toLowerCase().replace(/[^a-z]/g, '-')}-sub17-m`;
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

  // ── Competición ──────────────────────────────────────────────
  const compRes = await db.query<{ id: string }>(
    `INSERT INTO competitions
       (sport_id, name, short_name, slug, gender, category, country, scope, organizer, age_category, source_id, source_ref, scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'international','WSE','base',$8,$9,NOW())
     ON CONFLICT (sport_id, slug) DO UPDATE SET
       name = EXCLUDED.name,
       source_ref = EXCLUDED.source_ref,
       scope = 'international',
       organizer = 'WSE',
       updated_at = NOW()
     RETURNING id`,
    [sportId, COMPETITION.name, COMPETITION.shortName, COMPETITION.slug,
     COMPETITION.gender, COMPETITION.category, COMPETITION.country,
     sourceId, COMPETITION.sourceRef]
  );
  const competitionId = compRes.rows[0]!.id;
  log.info({ competitionId, name: COMPETITION.name }, '✅ Competición');

  // ── Temporada ────────────────────────────────────────────────
  await db.query(
    `UPDATE seasons SET is_current = FALSE WHERE competition_id = $1`, [competitionId]
  );
  const seasonRes = await db.query<{ id: string }>(
    `INSERT INTO seasons
       (competition_id, name, slug, start_date, end_date, is_current, timezone, source_id, source_ref, scraped_at)
     VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7,$8,NOW())
     ON CONFLICT (competition_id, slug) DO UPDATE SET
       is_current = TRUE,
       timezone = EXCLUDED.timezone,
       source_ref = EXCLUDED.source_ref,
       updated_at = NOW()
     RETURNING id`,
    [competitionId, SEASON.name, SEASON.slug, SEASON.startDate, SEASON.endDate,
     SEASON.timezone, sourceId, SEASON.sourceRef]
  );
  const seasonId = seasonRes.rows[0]!.id;
  log.info({ seasonId, name: SEASON.name, tz: SEASON.timezone }, '✅ Temporada');

  // ── Selecciones ──────────────────────────────────────────────
  for (const team of TEAMS) {
    const ref = `wse_${team.sidgadId}`;
    const slug = teamSlug(team.country);
    const logoUrl = `${LOGO_BASE}${team.logo}.png`;

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
      [sportId, team.name, team.shortName, slug, team.country, logoUrl,
       GENDER, AGE_CATEGORY, sourceId, ref, [team.sidgadId]]
    );
    const teamId = teamRes.rows[0]!.id;

    await db.query(
      `INSERT INTO season_teams (season_id, team_id)
       VALUES ($1,$2)
       ON CONFLICT (season_id, team_id) DO NOTHING`,
      [seasonId, teamId]
    );
  }
  log.info({ count: TEAMS.length }, '✅ Selecciones insertadas y asociadas a la temporada');

  console.log('\n══════════════════════════════════════════════');
  console.log('✅ SEED WORLD SKATE U17 COMPLETADO');
  console.log('══════════════════════════════════════════════');
  console.log(`COMPETITION_ID=${competitionId}`);
  console.log(`SEASON_ID=${seasonId}`);
  console.log(`SPORT_ID=${sportId}`);
  console.log(`SOURCE_ID=${sourceId}`);
  console.log('══════════════════════════════════════════════');
}

seed()
  .catch((err) => { log.error({ err }, 'Error en seed'); process.exit(1); })
  .finally(() => closeDb());
