/**
 * Seed GENÉRICO de una competición FEP por idc.
 *
 * Reemplaza el patrón de seed-ok-liga.ts (equipos hardcodeados por temporada).
 * Se auto-descubre los equipos y sus refs sidgad desde la fuente:
 *   1) competicion_header_creator.php  → input#teams_array_{idc} (nombre+abbr+ref)
 *   2) fallback rfep_cal_idc_{idc}_1.php → clases team_XXXX + .nombre_junto_logo
 * y crea/actualiza: competición + temporada (is_current) + equipos + season_teams
 * + fila en competition_sources (external_ids.idc). Idempotente.
 *
 * Identidad de equipo por temporada: los ids sidgad CAMBIAN cada temporada, así
 * que si el club ya existe (por slug), el ref nuevo se añade a alt_source_refs en
 * vez de pisar source_ref (regla de [[project_sports_platform]]).
 *
 * Dry-run por defecto: imprime lo que insertaría. --write para escribir.
 *
 * Uso (en el contenedor etl, imagen compilada):
 *   node dist/apps/etl/src/seed-fep-competition.js \
 *     --idc=3568 --name="OK LIGA MASCULINA" --short="OK Liga" \
 *     --gender=male --season=2026/27 --temp=40 --write
 */
import { db, closeDb, findTeamBySourceRef, findTeamBySlug, addTeamAltRef, upsertCompetitionSource } from '@sports/db';
import { createLogger } from '@sports/logger';
import { sidgadPost, SIDGAD_LANG } from '../../scraper/src/scrapers/fep/sidgad-client.js';
import * as cheerio from 'cheerio';

const log = createLogger({ service: 'seed-fep' });

const SPORT_SLUG = 'hockey-patines';
const SOURCE_SCRAPER_KEY = 'fep_hockey';

// ── Args ──────────────────────────────────────────────────────────
const argv = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.length ? v.join('=') : 'true'];
  }),
) as Record<string, string>;

function req(k: string): string {
  const v = argv[k];
  if (!v) { console.error(`❌ Falta --${k}`); process.exit(1); }
  return v;
}

const IDC = req('idc');
const NAME = req('name');
const SHORT = argv['short'] ?? NAME;
const GENDER = (argv['gender'] ?? 'male') as 'male' | 'female';
const CATEGORY = argv['category'] ?? 'senior';
const AGE = argv['age'] ?? 'senior';
const SCOPE = argv['scope'] ?? 'national';
const ORGANIZER = argv['organizer'] ?? 'RFEP';
const REGION = argv['region'] ?? null;
const COUNTRY = argv['country'] ?? 'ES';
const SEASON_NAME = argv['season'] ?? '2026/27';
const SEASON_SLUG = SEASON_NAME.replace(/\//g, '-');
const START = argv['start'] ?? '2026-09-01';
const END = argv['end'] ?? '2027-06-30';
const TEMP = argv['temp'] ? `temp_${argv['temp']}` : null;
const ACTIVE = argv['active'] !== 'false';
const WRITE = argv['write'] === 'true' || argv['write'] === '1';

function slugify(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

interface DiscTeam { ref: string; name: string; abbr: string; }

// La fuente mete un pseudo-equipo 'DESCANSO' como bye en ligas de nº impar (Bronce N/S).
const isBye = (n: string): boolean => /^\s*descanso\s*$/i.test(n || '');

function parseTeamsArray(html: string): DiscTeam[] {
  const $ = cheerio.load(html);
  const val = $(`input#teams_array_${IDC}`).attr('value')
    ?? $('input[id^="teams_array_"]').first().attr('value') ?? '';
  // "logo.png,ref,abbr,NAME;logo.png,ref,abbr,NAME;..."
  return val.split(';').filter(Boolean).map((chunk) => {
    const [, ref = '', abbr = '', ...nameParts] = chunk.split(',');
    return { ref: ref.trim(), abbr: abbr.trim(), name: nameParts.join(',').trim() };
  }).filter((t) => t.ref && t.name && !isBye(t.name));
}

function parseTeamsFromCalendar(html: string): DiscTeam[] {
  const $ = cheerio.load(html);
  const byRef = new Map<string, DiscTeam>();
  $('tbody tr.team_class').each((_, row) => {
    const $row = $(row);
    const teamClasses = ($row.attr('class') ?? '').split(/\s+/)
      .filter((c) => c.startsWith('team_') && c !== 'team_class').map((c) => c.replace('team_', ''));
    const names = $row.find('.nombre_junto_logo').map((_, el) => $(el).text().trim()).get();
    teamClasses.forEach((ref, i) => {
      const nm = names[i] ?? '';
      if (ref && !byRef.has(ref) && !isBye(nm)) byRef.set(ref, { ref, name: nm || `Equipo ${ref}`, abbr: '' });
    });
  });
  return [...byRef.values()];
}

async function discoverTeams(): Promise<DiscTeam[]> {
  let teams: DiscTeam[] = [];
  try {
    const header = await sidgadPost('competicion_header_creator.php', { idc: IDC, site_lang: SIDGAD_LANG });
    teams = parseTeamsArray(header);
    log.info({ n: teams.length }, 'Equipos desde header_creator');
  } catch (err) { log.warn({ err }, 'header_creator falló'); }
  if (teams.length === 0) {
    const cal = await sidgadPost(`rfep_cal_idc_${IDC}_1.php`, { idc: IDC, site_lang: SIDGAD_LANG });
    teams = parseTeamsFromCalendar(cal);
    log.info({ n: teams.length }, 'Equipos desde calendario (fallback)');
  }
  return teams;
}

async function main() {
  const sport = (await db.query<{ id: string }>(`SELECT id FROM sports WHERE slug=$1`, [SPORT_SLUG])).rows[0];
  if (!sport) throw new Error(`Deporte no encontrado: ${SPORT_SLUG}`);
  const source = (await db.query<{ id: string }>(`SELECT id FROM data_sources WHERE scraper_key=$1`, [SOURCE_SCRAPER_KEY])).rows[0];
  if (!source) throw new Error(`DataSource no encontrado: ${SOURCE_SCRAPER_KEY}`);
  const sportId = sport.id, sourceId = source.id;

  const teams = await discoverTeams();
  const compSlug = slugify(NAME);

  console.log('\n──────── SEED FEP (dry-run=' + String(!WRITE) + ') ────────');
  console.log(`Competición: ${NAME} [${compSlug}] idc=${IDC} ${GENDER}/${AGE} ${SCOPE}/${ORGANIZER}${REGION ? '/' + REGION : ''}`);
  console.log(`Temporada:   ${SEASON_NAME} [${SEASON_SLUG}] ${START}→${END} ${TEMP ?? '(sin temp)'} · active=${ACTIVE}`);
  console.log(`Equipos (${teams.length}):`);
  teams.forEach((t) => console.log(`  ${t.ref.padEnd(6)} ${t.abbr.padEnd(5)} ${t.name}`));
  if (teams.length === 0) console.log('  ⚠️  Ninguno (plantilla no publicada aún): se crea competición+temporada+source igual.');

  if (!WRITE) {
    console.log('\n(dry-run) No se ha escrito nada. Repite con --write para confirmar.\n');
    return;
  }

  // ── Competición ──
  const comp = (await db.query<{ id: string }>(
    `INSERT INTO competitions (sport_id, name, short_name, slug, gender, category, age_category, scope, organizer, region, country, source_id, source_ref, scraped_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
     ON CONFLICT (sport_id, slug) DO UPDATE SET
       name=EXCLUDED.name, short_name=EXCLUDED.short_name, gender=EXCLUDED.gender,
       age_category=EXCLUDED.age_category, scope=EXCLUDED.scope, organizer=EXCLUDED.organizer,
       region=EXCLUDED.region, source_ref=EXCLUDED.source_ref, updated_at=NOW()
     RETURNING id`,
    [sportId, NAME, SHORT, compSlug, GENDER, CATEGORY, AGE, SCOPE, ORGANIZER, REGION, COUNTRY, sourceId, IDC],
  )).rows[0]!;

  // ── Temporada (is_current) ──
  await db.query(`UPDATE seasons SET is_current=FALSE WHERE competition_id=$1`, [comp.id]);
  const season = (await db.query<{ id: string }>(
    `INSERT INTO seasons (competition_id, name, slug, start_date, end_date, is_current, source_id, source_ref, scraped_at)
     VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7,NOW())
     ON CONFLICT (competition_id, slug) DO UPDATE SET
       is_current=TRUE, start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date,
       source_ref=EXCLUDED.source_ref, updated_at=NOW()
     RETURNING id`,
    [comp.id, SEASON_NAME, SEASON_SLUG, START, END, sourceId, TEMP],
  )).rows[0]!;

  // ── Equipos (identidad por temporada) ──
  let created = 0, reused = 0, aliased = 0;
  for (const t of teams) {
    let team: { id: string } | null = await findTeamBySourceRef(t.ref);
    if (team) {
      reused++;
    } else {
      const slug = slugify(t.name);
      const bySlug = await findTeamBySlug(sportId, slug);
      if (bySlug) {
        await addTeamAltRef(bySlug.id, t.ref); // nuevo ref de temporada, no pisar source_ref
        team = bySlug; aliased++;
      } else {
        team = (await db.query<{ id: string }>(
          `INSERT INTO teams (sport_id, name, short_name, slug, country, source_id, source_ref, scraped_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING id`,
          [sportId, t.name, t.abbr || null, slug, COUNTRY, sourceId, t.ref],
        )).rows[0]!;
        created++;
      }
    }
    await db.query(
      `INSERT INTO season_teams (season_id, team_id) VALUES ($1,$2) ON CONFLICT (season_id, team_id) DO NOTHING`,
      [season.id, team!.id],
    );
  }

  // ── competition_sources ──
  await upsertCompetitionSource({
    competitionId: comp.id,
    sourceId,
    externalIds: { idc: IDC, playoff_idcs: [], cup_idcs: [] },
    isActive: ACTIVE,
  });

  console.log('\n══════════════ SEED COMPLETADO ══════════════');
  console.log(`COMPETITION_ID=${comp.id}`);
  console.log(`SEASON_ID=${season.id}`);
  console.log(`SOURCE_ID=${sourceId}`);
  console.log(`Equipos: nuevos=${created} reusados=${reused} alias=${aliased}`);
  console.log('═════════════════════════════════════════════');
  console.log('\nCarga inicial (mismo contenedor):');
  console.log(`  node dist/apps/etl/src/run-pipeline.js --entity=calendar  --idc=${IDC} --season-id=${season.id}`);
  console.log(`  node dist/apps/etl/src/run-pipeline.js --entity=standings --idc=${IDC} --season-id=${season.id}`);
}

main().catch((err) => { log.error({ err }, 'Error en seed'); process.exit(1); }).finally(() => closeDb());
