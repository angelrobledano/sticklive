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
import {
  db, closeDb,
  findTeamBySourceRef, findTeamBySlug, addTeamAltRef, upsertCompetitionSource,
  findTeamByNormalizedAlias, findSimilarTeamNames, enqueueResolution, upsertSourceEntityMapTeam,
} from '@sports/db';
import { normalizeTeamName } from './transformers/normalize.js';
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
// Filial: 1 = primer equipo, 2 = "B", 3 = "C" (diseño ER: club × género ×
// categoría × filial son la identidad del equipo, no el nombre).
const SQUAD_LEVEL = Number(argv['squad-level'] ?? '1');
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
// Altas de club confirmadas por un humano (el panel HITL no crea entidades, solo
// asigna o descarta): estas refs se fuerzan a "nuevo" aunque la similitud
// encuentre candidatos. Formato: --force-new=3729,3737,3695
const FORCE_NEW = (argv['force-new'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
// Competiciones que COMPARTEN equipos legítimamente (copas, supercopas): sin
// esta bandera, un equipo que ya juega en otra liga actual se manda a la cola.
const ALLOW_SHARED = argv['allow-shared'] === 'true' || argv['allow-shared'] === '1';

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

  // ── Clasificación de identidad (SOLO LECTURA) ──────────────────────────────
  // Antes de crear nada: ¿este equipo ya existe? Mismo embudo que el ETL —
  // ref de fuente → slug → alias normalizado → similitud de nombre contra los
  // equipos REALES. Un club renombrado por patrocinio cae en "dudoso" y NO se
  // crea: va a la cola HITL para un clic humano (regla de oro del ER).
  //
  // GÉNERO: un equipo sin género marcado se puede reutilizar (y se rellena);
  // uno del género contrario NO — es la otra sección (M/F) del mismo club, y
  // reutilizarlo mezclaría historiales y estadísticas.
  type Accion = 'reusar-ref' | 'reusar-slug' | 'reusar-alias' | 'dudoso' | 'nuevo';
  interface Fila { t: DiscTeam; accion: Accion; teamId?: string; candidatos?: { teamId: string; name: string; gender: string | null; score: number }[]; }
  const mismoGenero = (g?: string | null) => !g || g === GENDER;
  const mismaCategoria = (a?: string | null) => !a || a === AGE;
  /**
   * ¿Ese equipo ya juega en OTRA competición con temporada actual?
   *
   * Señal de FILIAL nombrado igual: el club tiene su primer equipo en una liga y
   * el filial en otra, la fuente los llama igual y sus refs son distintas. La
   * regla del proyecto es resolver por REFERENCIA, nunca por slug, así que un
   * match por slug con un equipo ya en liza se aparca para un humano en vez de
   * unirse (fue el bug del NOIA A/B). Las copas comparten equipos de verdad:
   * se siembran con --allow-shared.
   */
  const enOtraLigaActual = async (teamId: string): Promise<boolean> => {
    const r = await db.query(
      `SELECT 1 FROM season_teams st
         JOIN seasons s ON s.id = st.season_id AND s.is_current
         JOIN competitions c ON c.id = s.competition_id
        WHERE st.team_id = $1 AND c.slug <> $2
        LIMIT 1`,
      [teamId, compSlug],
    );
    return (r.rowCount ?? 0) > 0;
  };
  /**
   * Salud del candidato (#195): los SÚPER-EQUIPOS del legado (#192) fusionaron
   * secciones M/F/cantera en una fila y tienen gender NULL, así que
   * `mismoGenero` los deja pasar. Reutilizar una fila con historial MEZCLADO
   * (más de un género o categoría en sus season_teams) hereda ese historial al
   * equipo nuevo. Solo se aplica a los match por NOMBRE (slug/alias): un match
   * por source_ref es la misma entidad de la fuente, su historial es el que es.
   */
  const mezclaEnHistorial = async (teamId: string): Promise<boolean> => {
    const r = await db.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM season_teams st
           JOIN seasons s ON s.id = st.season_id
           JOIN competitions c ON c.id = s.competition_id
          WHERE st.team_id = $1 AND c.gender IS NOT NULL
         HAVING COUNT(DISTINCT c.gender) > 1
       ) OR EXISTS (
         SELECT 1 FROM season_teams st
           JOIN seasons s ON s.id = st.season_id
           JOIN competitions c ON c.id = s.competition_id
          WHERE st.team_id = $1 AND c.age_category IS NOT NULL
         HAVING COUNT(DISTINCT c.age_category) > 1
       ) AS ok`,
      [teamId],
    );
    return r.rows[0]?.ok ?? false;
  };
  const gTag = (g?: string | null) => (g === 'female' ? 'F' : g === 'male' ? 'M' : '·');
  const etiqueta = `[${gTag(GENDER)}/${AGE}${SQUAD_LEVEL > 1 ? `/B${SQUAD_LEVEL}` : ''}]`;
  const plan: Fila[] = [];
  for (const t of teams) {
    const byRef = await findTeamBySourceRef(t.ref);
    if (byRef) {
      if (mismoGenero(byRef.gender) && mismaCategoria(byRef.age_category)) { plan.push({ t, accion: 'reusar-ref', teamId: byRef.id }); continue; }
      // La ref apunta a un equipo de otra sección (género/categoría): dato
      // inconsistente → a la cola.
      plan.push({ t, accion: 'dudoso', candidatos: [{ teamId: byRef.id, name: byRef.name, gender: byRef.gender ?? null, score: 1 }] });
      continue;
    }
    const bySlug = await findTeamBySlug(sportId, slugify(t.name));
    if (bySlug && mismoGenero(bySlug.gender) && mismaCategoria(bySlug.age_category)) {
      // Ya juega en otra liga actual → es un filial nombrado igual: a la cola.
      if (!ALLOW_SHARED && await enOtraLigaActual(bySlug.id)) {
        plan.push({ t, accion: 'dudoso', candidatos: [{ teamId: bySlug.id, name: bySlug.name, gender: bySlug.gender ?? null, score: 1 }] });
        continue;
      }
      // Súper-equipo del legado (#195): gender NULL pasa el filtro de arriba,
      // pero si su historial mezcla géneros/categorías es una fila fusionada.
      if (await mezclaEnHistorial(bySlug.id)) {
        plan.push({ t, accion: 'dudoso', candidatos: [{ teamId: bySlug.id, name: bySlug.name, gender: bySlug.gender ?? null, score: 1 }] });
        continue;
      }
      plan.push({ t, accion: 'reusar-slug', teamId: bySlug.id });
      continue;
    }
    const aliasId = await findTeamByNormalizedAlias(normalizeTeamName(t.name), sourceId);
    if (aliasId) {
      const g = (await db.query<{ name: string; gender: string | null; age_category: string | null }>(`SELECT name, gender, age_category FROM teams WHERE id=$1`, [aliasId])).rows[0];
      if (mismoGenero(g?.gender) && mismaCategoria(g?.age_category)) {
        if (!ALLOW_SHARED && await enOtraLigaActual(aliasId)) {
          plan.push({ t, accion: 'dudoso', candidatos: [{ teamId: aliasId, name: g!.name, gender: g?.gender ?? null, score: 1 }] });
          continue;
        }
        if (await mezclaEnHistorial(aliasId)) {
          plan.push({ t, accion: 'dudoso', candidatos: [{ teamId: aliasId, name: g!.name, gender: g?.gender ?? null, score: 1 }] });
          continue;
        }
        plan.push({ t, accion: 'reusar-alias', teamId: aliasId });
        continue;
      }
    }
    // Alta confirmada a mano: se crea aunque haya candidatos por similitud.
    if (FORCE_NEW.includes(t.ref)) { plan.push({ t, accion: 'nuevo' }); continue; }
    const candidatos = await findSimilarTeamNames(t.name, sportId, { gender: GENDER, ageCategory: AGE }, 3);
    if (candidatos.length > 0) { plan.push({ t, accion: 'dudoso', candidatos }); continue; }
    plan.push({ t, accion: 'nuevo' });
  }
  const cuenta = (a: Accion) => plan.filter((f) => f.accion === a).length;
  console.log(
    `\nSección de la liga: ${etiqueta} · identidad: reusar(ref ${cuenta('reusar-ref')}, slug ${cuenta('reusar-slug')}, ` +
      `alias ${cuenta('reusar-alias')}) · dudosos→cola ${cuenta('dudoso')} · nuevos ${cuenta('nuevo')}`
  );
  for (const f of plan.filter((x) => x.accion === 'dudoso')) {
    console.log(`  ?  ${f.t.ref.padEnd(6)} ${f.t.name}`);
    console.log(`       candidatos: ${f.candidatos!.map((c) => `${c.name} [${gTag(c.gender)}] (${c.score.toFixed(2)})`).join(' · ')}`);
  }
  for (const f of plan.filter((x) => x.accion === 'nuevo')) {
    console.log(`  +  ${f.t.ref.padEnd(6)} ${f.t.name} → se creará ${etiqueta}`);
  }

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
  let created = 0, reused = 0, aliased = 0, pending = 0;
  for (const f of plan) {
    const t = f.t;
    let teamId: string | null = f.teamId ?? null;

    if (f.accion === 'reusar-ref') {
      // Rellena género/categoría si faltaban (COALESCE: no pisa lo que ya hay).
      await db.query(
        `UPDATE teams SET gender=COALESCE(gender,$2), age_category=COALESCE(age_category,$3), updated_at=NOW() WHERE id=$1`,
        [teamId, GENDER, AGE],
      );
      reused++;
    } else if (f.accion === 'reusar-slug' || f.accion === 'reusar-alias') {
      // La ref de esta temporada es nueva: se AÑADE (no se pisa source_ref) y se
      // alimenta el mapa de fuente para que la próxima entre por el escalón 1.
      await addTeamAltRef(teamId!, t.ref);
      await upsertSourceEntityMapTeam(sourceId, t.ref, teamId!).catch(() => {});
      await db.query(
        `UPDATE teams SET gender=COALESCE(gender,$2), age_category=COALESCE(age_category,$3), updated_at=NOW() WHERE id=$1`,
        [teamId, GENDER, AGE],
      );
      aliased++;
    } else if (f.accion === 'dudoso') {
      // No se crea nada: queda en la cola HITL con sus candidatos. Al resolverlo
      // en /admin/resolucion se aprende el alias y re-ejecutar el seed lo reusa.
      await enqueueResolution({
        rawText: t.name,
        normalized: normalizeTeamName(t.name),
        sourceId,
        sourceRef: t.ref,
        context: { sportId, from: 'seed-fep-competition' },
        candidates: f.candidatos,
      }).catch(() => {});
      pending++;
      continue;
    } else {
      // Slug único: el nombre solo no basta (mismo club en senior y cantera, o en
      // secciones M/F, o un filial). Sufijos en orden: categoría (si no es
      // senior) → género → filial → ref, hasta que no choque.
      let slug = slugify(t.name);
      const libre = async (s: string) => !(await findTeamBySlug(sportId, s));
      if (!(await libre(slug)) && AGE !== 'senior') slug = `${slug}-${AGE}`;
      if (!(await libre(slug))) slug = `${slug}-${GENDER === 'female' ? 'f' : 'm'}`;
      if (!(await libre(slug)) && SQUAD_LEVEL > 1) slug = `${slug}-b${SQUAD_LEVEL}`;
      if (!(await libre(slug))) slug = `${slug}-${t.ref}`;
      teamId = (await db.query<{ id: string }>(
        `INSERT INTO teams (sport_id, name, short_name, slug, gender, age_category, squad_level, country, source_id, source_ref, scraped_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING id`,
        [sportId, t.name, t.abbr || null, slug, GENDER, AGE, SQUAD_LEVEL, COUNTRY, sourceId, t.ref],
      )).rows[0]!.id;
      await upsertSourceEntityMapTeam(sourceId, t.ref, teamId).catch(() => {});
      created++;
    }

    await db.query(
      `INSERT INTO season_teams (season_id, team_id) VALUES ($1,$2) ON CONFLICT (season_id, team_id) DO NOTHING`,
      [season.id, teamId],
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
  console.log(`Equipos: nuevos=${created} reusados=${reused} alias=${aliased} a-la-cola=${pending}`);
  console.log('═════════════════════════════════════════════');
  console.log('\nCarga inicial (mismo contenedor):');
  console.log(`  node dist/apps/etl/src/run-pipeline.js --entity=calendar  --idc=${IDC} --season-id=${season.id}`);
  console.log(`  node dist/apps/etl/src/run-pipeline.js --entity=standings --idc=${IDC} --season-id=${season.id}`);
}

main().catch((err) => { log.error({ err }, 'Error en seed'); process.exit(1); }).finally(() => closeDb());
