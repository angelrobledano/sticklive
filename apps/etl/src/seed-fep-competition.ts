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
import { currentSource, competitionSourceRefForSeed, clubRef } from '../../scraper/src/core/sources.js';
import { clubKeyFromLogo } from '../../scraper/src/core/sidgad-club.js';
import {
  db, closeDb,
  findTeamBySourceRef, findTeamBySlug, addTeamAltRef, upsertCompetitionSource,
  findTeamByNormalizedAlias, findSimilarTeamNames, enqueueResolution, upsertSourceEntityMapTeam, ensureClubForTeam, recordSeasonTeamRef,
} from '@sports/db';
import { normalizeTeamName } from './transformers/normalize.js';
import { deriveShortName } from './derive-short-name.js';
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
// Formato del calendario en la fuente (#166). `final_four` = torneo a 4
// (2 semifinales → final, partido único): sus rondas se crean como 'playoff'
// con numeración canónica semi=1/final=2, y la web lo pinta como cuadro.
const FORMAT = (argv['format'] ?? 'league') as 'league' | 'bracket' | 'final_four';
// Altas de club confirmadas por un humano (el panel HITL no crea entidades, solo
// asigna o descarta): estas refs se fuerzan a "nuevo" aunque la similitud
// encuentre candidatos. Formato: --force-new=3729,3737,3695
const FORCE_NEW = (argv['force-new'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
// Competiciones que COMPARTEN equipos legítimamente (copas, supercopas): sin
// esta bandera, un equipo que ya juega en otra liga actual se manda a la cola.
const ALLOW_SHARED = argv['allow-shared'] === 'true' || argv['allow-shared'] === '1';
// Ligas de un portal autonómico cuyos clubes ya tienen su primer equipo en otra
// liga actual (Barça en OK Liga y en Nacional Catalana): ese homónimo es su
// FILIAL. Con esta bandera se da de alta como equipo B/C (squad_level) en vez de
// aparcarlo en la cola. Sin ella, comportamiento de siempre (a la cola).
const FILIAL_IF_SHARED = argv['filial-if-shared'] === 'true' || argv['filial-if-shared'] === '1';
// Similitud mínima para que un candidato bloquee el alta (dudoso). Por debajo,
// es ruido de trigramas ("HOQUEI CLUB CASTELLAR" ~ "GIRONA CLUB HOQUEI" 0.43)
// y el equipo se crea. findSimilarTeamNames devuelve desde 0.35.
const MIN_SCORE = Number(argv['min-score'] ?? '0.35');
// Coincidencia casi exacta: mismo equipo (o su filial si ya juega otra liga).
const EXACT_SCORE = 0.95;
// Copas de UNA liga (Coppa Italia A2 → Serie A2): sus equipos se buscan PRIMERO
// entre los de la temporada actual de esa(s) liga(s), por nombre. Sin esto, el
// homónimo de un filial (HOCKEY TRISSINO de A2) se enganchaba por slug al
// PRIMER equipo (el de A1). Formato: --teams-from=1895 (idc, separados por coma).
const TEAMS_FROM = (argv['teams-from'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function slugify(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Nombre sin la letra de equipo final y la letra: "CP VIC  B" → { base: "CP VIC", letter: "B" }.
 * Solo una letra A-H suelta al final (no "HC" ni siglas pegadas).
 */
function teamLetter(name: string): { base: string; letter: string | null } {
  const n = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(.*\S)\s+([A-H])$/.exec(n);
  return m ? { base: m[1]!, letter: m[2]! } : { base: n, letter: null };
}

interface DiscTeam { ref: string; name: string; abbr: string; logo?: string; }

// La fuente mete un pseudo-equipo 'DESCANSO' como bye en ligas de nº impar (Bronce N/S).
const isBye = (n: string): boolean => /^\s*descanso\s*$/i.test(n || '');

function parseTeamsArray(html: string): DiscTeam[] {
  const $ = cheerio.load(html);
  const val = $(`input#teams_array_${IDC}`).attr('value')
    ?? $('input[id^="teams_array_"]').first().attr('value') ?? '';
  // "logo.png,ref,abbr,NAME;logo.png,ref,abbr,NAME;..."
  return val.split(';').filter(Boolean).map((chunk) => {
    const [logo = '', ref = '', abbr = '', ...nameParts] = chunk.split(',');
    return { ref: ref.trim(), abbr: abbr.trim(), name: nameParts.join(',').trim(), logo: logo.trim() };
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
  console.log(`Temporada:   ${SEASON_NAME} [${SEASON_SLUG}] ${START}→${END} ${TEMP ?? '(sin temp)'} · active=${ACTIVE} · format=${FORMAT}`);
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
  type Accion = 'reusar-ref' | 'reusar-slug' | 'reusar-alias' | 'dudoso' | 'nuevo' | 'filial';
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
   * ¿Ese candidato tiene historial de OTRA sección (género/categoría)?
   *
   * `mismoGenero`/`mismaCategoria` dejan pasar a los NULL del legado porque no
   * sabemos qué son. Pero si el equipo YA jugó competiciones con género/categoría
   * conocidos y distintos de los de esta liga, reutilizarlo mezcla dos secciones
   * del mismo club: fue el caso CH MATARÓ (la ficha masculina se reutilizó para
   * la OK Liga Femenina porque su `gender` era NULL y su historial sólo era
   * masculino). Un historial mixto o de la sección contraria se aparca en HITL.
   */
  const historialIncompatible = async (teamId: string): Promise<boolean> => {
    const r = await db.query<{ incompatible: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM season_teams st
           JOIN seasons s ON s.id = st.season_id
           JOIN competitions c ON c.id = s.competition_id
          WHERE st.team_id = $1 AND c.gender IS NOT NULL AND c.gender <> $2
       ) OR EXISTS (
         SELECT 1 FROM season_teams st
           JOIN seasons s ON s.id = st.season_id
           JOIN competitions c ON c.id = s.competition_id
          WHERE st.team_id = $1 AND c.age_category IS NOT NULL AND c.age_category <> $3
       ) AS incompatible`,
      [teamId, GENDER, AGE],
    );
    return r.rows[0]?.incompatible ?? false;
  };
  const gTag = (g?: string | null) => (g === 'female' ? 'F' : g === 'male' ? 'M' : '·');
  const etiqueta = `[${gTag(GENDER)}/${AGE}${SQUAD_LEVEL > 1 ? `/B${SQUAD_LEVEL}` : ''}]`;
  const plan: Fila[] = [];
  // Equipos de la(s) liga(s) madre de esta copa, por nombre normalizado.
  const ligaMadre = new Map<string, string>();
  let ambiguosMadre = new Set<string>();
  let idsMadre: string[] = [];
  if (TEAMS_FROM.length > 0) {
    const refs = TEAMS_FROM.flatMap((idc) => [idc, competitionSourceRefForSeed(currentSource(), idc)]);
    const r = await db.query<{ id: string; name: string }>(
      `SELECT DISTINCT t.id, t.name FROM competitions c
         JOIN seasons s ON s.competition_id = c.id AND s.is_current
         JOIN season_teams st ON st.season_id = s.id
         JOIN teams t ON t.id = st.team_id
        WHERE c.source_ref = ANY($1)`,
      [refs],
    );
    const dup = new Set<string>();
    for (const row of r.rows) {
      const k = normalizeTeamName(row.name);
      if (ligaMadre.has(k)) dup.add(k); else ligaMadre.set(k, row.id);
    }
    for (const k of dup) ligaMadre.delete(k); // dos homónimos en la liga madre: que decida un humano
    ambiguosMadre = dup;
    idsMadre = r.rows.map((row) => row.id);
    console.log(`Liga(s) madre ${TEAMS_FROM.join(',')}: ${r.rows.length} equipos (${dup.size} nombres ambiguos)`);
  }
  for (const t of teams) {
    if (TEAMS_FROM.length > 0) {
      // Copa de una liga: SOLO equipos de esa liga. Nunca se cae a la búsqueda
      // general (engancharía el homónimo al primer equipo de otra categoría).
      const k = normalizeTeamName(t.name);
      const exacto = ligaMadre.get(k);
      if (exacto) { plan.push({ t, accion: 'reusar-alias', teamId: exacto }); continue; }
      const sim = ambiguosMadre.has(k) ? [] : (await db.query<{ id: string; name: string; gender: string | null; score: number }>(
        `SELECT id, name, gender, similarity(lower(name), lower($1))::float AS score
           FROM teams WHERE id = ANY($2) ORDER BY score DESC LIMIT 2`,
        [t.name, idsMadre],
      )).rows;
      const [a, b] = sim;
      if (a && a.score >= MIN_SCORE && (!b || a.score - b.score >= 0.1)) {
        plan.push({ t, accion: 'reusar-alias', teamId: a.id }); continue;
      }
      plan.push({ t, accion: 'dudoso', candidatos: sim.map((x) => ({ teamId: x.id, name: x.name, gender: x.gender, score: Number(x.score) })) });
      continue;
    }
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
        if (FILIAL_IF_SHARED && !(await historialIncompatible(bySlug.id))) { plan.push({ t, accion: 'filial', teamId: bySlug.id }); continue; }
        plan.push({ t, accion: 'dudoso', candidatos: [{ teamId: bySlug.id, name: bySlug.name, gender: bySlug.gender ?? null, score: 1 }] });
        continue;
      }
      // Súper-equipo del legado (#195): gender NULL pasa el filtro de arriba,
      // pero si su historial es de otra sección (o mezcla géneros/categorías)
      // es una fila fusionada y se aparca en HITL.
      if (await historialIncompatible(bySlug.id)) {
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
          if (FILIAL_IF_SHARED && !(await historialIncompatible(aliasId))) { plan.push({ t, accion: 'filial', teamId: aliasId }); continue; }
          plan.push({ t, accion: 'dudoso', candidatos: [{ teamId: aliasId, name: g!.name, gender: g?.gender ?? null, score: 1 }] });
          continue;
        }
        if (await historialIncompatible(aliasId)) {
          plan.push({ t, accion: 'dudoso', candidatos: [{ teamId: aliasId, name: g!.name, gender: g?.gender ?? null, score: 1 }] });
          continue;
        }
        plan.push({ t, accion: 'reusar-alias', teamId: aliasId });
        continue;
      }
    }
    // Alta confirmada a mano: se crea aunque haya candidatos por similitud.
    if (FORCE_NEW.includes(t.ref)) { plan.push({ t, accion: 'nuevo' }); continue; }
    // Letra de equipo (#base): "CP VIC B" frente a "CP VIC A" (o "CP VIC") es
    // OTRO equipo del mismo club, no un dudoso. Si el candidato más parecido
    // solo difiere en la letra final, se crea (squad_level sale de la letra).
    {
      const sim = (await findSimilarTeamNames(t.name, sportId, { gender: GENDER, ageCategory: AGE }, 3))
        .filter((c) => c.score >= MIN_SCORE);
      const mine = teamLetter(t.name);
      if (sim.length > 0 && sim.some((c) => {
        const theirs = teamLetter(c.name);
        return theirs.base === mine.base && theirs.letter !== mine.letter;
      }) && !sim.some((c) => teamLetter(c.name).base === mine.base && teamLetter(c.name).letter === mine.letter)) {
        plan.push({ t, accion: 'nuevo' });
        continue;
      }
    }
    const candidatos = (await findSimilarTeamNames(t.name, sportId, { gender: GENDER, ageCategory: AGE }, 3))
      .filter((c) => c.score >= MIN_SCORE);
    const top = candidatos[0];
    // Casi exacto, mismo género y sin rival cercano: es ESE equipo (torneo
    // compartido, --allow-shared) o su filial (liga, --filial-if-shared).
    const inequivoco = top && top.score >= EXACT_SCORE && top.gender === GENDER
      && (candidatos[1]?.score ?? 0) < EXACT_SCORE && !(await historialIncompatible(top.teamId));
    if (inequivoco) {
      if (await enOtraLigaActual(top.teamId)) {
        if (ALLOW_SHARED) { plan.push({ t, accion: 'reusar-alias', teamId: top.teamId }); continue; }
        if (FILIAL_IF_SHARED) { plan.push({ t, accion: 'filial', teamId: top.teamId }); continue; }
      } else if (ALLOW_SHARED || FILIAL_IF_SHARED) {
        plan.push({ t, accion: 'reusar-alias', teamId: top.teamId }); continue;
      }
    }
    if (candidatos.length > 0) { plan.push({ t, accion: 'dudoso', candidatos }); continue; }
    plan.push({ t, accion: 'nuevo' });
  }
  const cuenta = (a: Accion) => plan.filter((f) => f.accion === a).length;
  console.log(
    `\nSección de la liga: ${etiqueta} · identidad: reusar(ref ${cuenta('reusar-ref')}, slug ${cuenta('reusar-slug')}, ` +
      `alias ${cuenta('reusar-alias')}) · filiales ${cuenta('filial')} · dudosos→cola ${cuenta('dudoso')} · nuevos ${cuenta('nuevo')}`
  );
  for (const f of plan.filter((x) => x.accion === 'dudoso')) {
    console.log(`  ?  ${f.t.ref.padEnd(6)} ${f.t.name}`);
    console.log(`       candidatos: ${f.candidatos!.map((c) => `${c.name} [${gTag(c.gender)}] (${c.score.toFixed(2)})`).join(' · ')}`);
  }
  for (const f of plan.filter((x) => x.accion === 'filial')) {
    console.log(`  B  ${f.t.ref.padEnd(6)} ${f.t.name} → filial de un equipo que ya juega otra liga actual`);
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
    [sportId, NAME, SHORT, compSlug, GENDER, CATEGORY, AGE, SCOPE, ORGANIZER, REGION, COUNTRY, sourceId, competitionSourceRefForSeed(currentSource(), IDC)],
  )).rows[0]!;

  // ── Temporada (is_current) ──
  // GUARDA nombre↔fechas (#327): la season OK Liga 2025/26 llegó a prod con el
  // rango de 2024/25 (copiapé de la season anterior) y 209 partidos quedaron
  // fuera de ventana. Antes de escribir se valida que el rango cuadre con el
  // NOMBRE: "2025/26" ⇒ el año de start ∈ {2025, 2026} y el de end ∈ {2025, 2026},
  // y end > start. Un fallo aquí aborta el seed (los datos del CLI están mal).
  {
    const m = /^(20\d{2})\/(20\d{2})$/.exec(SEASON_NAME);
    if (m) {
      const y0 = Number(m[1]), y1 = Number(m[2]);
      const sy = new Date(START).getUTCFullYear();
      const ey = new Date(END).getUTCFullYear();
      const okInicio = sy === y0 || sy === y1;
      const okFin = ey === y0 || ey === y1;
      if (!okInicio || !okFin || new Date(END) <= new Date(START)) {
        throw new Error(
          `#327: fechas incoherentes con el nombre de la temporada: ${SEASON_NAME} con ${START} → ${END}. ` +
          `Revisa --start/--end (los partidos caerían fuera de ventana y la guarda #229 los rechazaría).`
        );
      }
    }
  }
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
    // Abreviatura: la de la fuente si la hay; si no, la derivada del nombre
    // (la fuente del calendario no trae abreviatura → antes quedaba NULL y la
    // web mostraba el nombre completo en listas móviles).
    const short = (t.abbr || deriveShortName(t.name)).trim() || null;
    let teamId: string | null = f.teamId ?? null;

    if (f.accion === 'reusar-ref') {
      // Rellena género/categoría si faltaban (COALESCE: no pisa lo que ya hay).
      await db.query(
        `UPDATE teams SET gender=COALESCE(gender,$2), age_category=COALESCE(age_category,$3),
                          short_name=COALESCE(NULLIF(short_name,''), $4), updated_at=NOW() WHERE id=$1`,
        [teamId, GENDER, AGE, short],
      );
      reused++;
    } else if (f.accion === 'reusar-slug' || f.accion === 'reusar-alias') {
      // La ref de esta temporada es nueva: se AÑADE (no se pisa source_ref) y se
      // alimenta el mapa de fuente para que la próxima entre por el escalón 1.
      await addTeamAltRef(teamId!, t.ref);
      await upsertSourceEntityMapTeam(sourceId, t.ref, teamId!).catch(() => {});
      await db.query(
        `UPDATE teams SET gender=COALESCE(gender,$2), age_category=COALESCE(age_category,$3),
                          short_name=COALESCE(NULLIF(short_name,''), $4), updated_at=NOW() WHERE id=$1`,
        [teamId, GENDER, AGE, short],
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
      // Filial (--filial-if-shared): nivel = siguiente libre entre los equipos
      // de la MISMA sección (género + categoría) de ese club. El club sale del
      // equipo base (A4); sin club, de los slugs `{base}`, `{base}-b2`…
      let nivelFilial = 0;
      if (f.accion === 'filial' && f.teamId) {
        const r = await db.query<{ n: number }>(
          `SELECT COALESCE(MAX(t.squad_level), 1)::int AS n
             FROM teams base
             JOIN teams t ON t.sport_id = base.sport_id
                         AND t.gender IS NOT DISTINCT FROM base.gender
                         AND t.age_category IS NOT DISTINCT FROM base.age_category
                         AND ((base.club_id IS NOT NULL AND t.club_id = base.club_id)
                              OR t.id = base.id OR t.slug ~ ('^' || base.slug || '-b[0-9]+$'))
            WHERE base.id = $1`,
          [f.teamId],
        );
        nivelFilial = (r.rows[0]?.n ?? 1) + 1;
        console.log(`  ℹ️  ${t.name} → filial, squad_level=${nivelFilial}`);
      }
      // Slug único: el nombre solo no basta (mismo club en senior y cantera, o en
      // secciones M/F, o un filial). Sufijos en orden: categoría (si no es
      // senior) → género → filial → ref, hasta que no choque.
      let slug = slugify(t.name);
      if (nivelFilial > 1) slug = `${slug}-b${nivelFilial}`;
      const libre = async (s: string) => !(await findTeamBySlug(sportId, s));
      if (!(await libre(slug)) && AGE !== 'senior') slug = `${slug}-${AGE}`;
      if (!(await libre(slug))) slug = `${slug}-${GENDER === 'female' ? 'f' : 'm'}`;
      if (!(await libre(slug)) && SQUAD_LEVEL > 1) slug = `${slug}-b${SQUAD_LEVEL}`;
      if (!(await libre(slug))) slug = `${slug}-${t.ref}`;
      // #198: derivar squad_level del NOMBRE de la fuente ("X B", "X II", "X 2"
      // al final) cuando el flag CLI no lo diga — el seed masivo de ligas no
      // pasa --squad-level y los filiales entraban como primer equipo. Sólo se
      // sube de nivel (nunca se baja el del flag). "B B" ruidoso cuenta una vez.
      const letra = teamLetter(t.name).letter;
      const nivelNombre = / (?:II|2)$/i.test(t.name) ? 2
        : letra ? Math.max(1, 'ABCDEFGH'.indexOf(letra) + 1) : 1;
      const nivelFinal = Math.max(SQUAD_LEVEL, nivelNombre, nivelFilial);
      if (nivelNombre > 1) {
        console.log(`  ℹ️  ${t.name} → squad_level=${nivelNombre} (derivado del nombre, #198)`);
      }
      teamId = (await db.query<{ id: string }>(
        `INSERT INTO teams (sport_id, name, short_name, slug, gender, age_category, squad_level, country, source_id, source_ref, scraped_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING id`,
        [sportId, t.name, short, slug, GENDER, AGE, nivelFinal, COUNTRY, sourceId, t.ref],
      )).rows[0]!.id;
      await upsertSourceEntityMapTeam(sourceId, t.ref, teamId).catch(() => {});
      created++;
    }

    // A4: el escudo del teams_array ES el id de club sidgad. Se cuelga el
    // equipo de su club (creándolo si hace falta) por esa clave estable.
    const clubKey = clubKeyFromLogo(t.logo);
    if (clubKey && teamId) {
      await ensureClubForTeam({
        teamId, sourceId, clubRef: clubRef(currentSource(), clubKey), name: t.name,
      }).catch((err) => log.warn({ err, team: t.name }, 'No se pudo enlazar el club (A4)'));
    }

    // A5: la ref de inscripción va en la inscripción (temporada), no solo en
    // el array global alt_source_refs.
    if (!(await recordSeasonTeamRef(season.id, teamId!, t.ref))) {
      log.warn({ team: t.name, ref: t.ref }, 'Ref de inscripción ya asignada a OTRO equipo en esta temporada (A5) — revisar');
    }
  }

  // ── competition_sources ──
  await upsertCompetitionSource({
    competitionId: comp.id,
    sourceId,
    externalIds: { idc: IDC, playoff_idcs: [], cup_idcs: [], ...(FORMAT !== 'league' ? { format: FORMAT } : {}) },
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
