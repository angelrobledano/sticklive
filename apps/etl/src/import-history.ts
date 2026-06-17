/**
 * IMPORTADOR DEL HISTÓRICO — siembra todo el catálogo RFEP en la BD.
 *
 * Lee el catálogo generado por el scraper (fep-catalog.json) y, por cada
 * competición de cada temporada:
 *   1. Upsert de la competición (agrupando patrocinadores: "PARLEM OK LIGA"
 *      y "OK LIGA MASCULINA" son la misma competición histórica).
 *   2. Upsert de la temporada (source_ref = idc, la clave para el scraping).
 *   3. Upsert de equipos + season_teams desde el teams_array del catálogo.
 *
 * Después, con --run, lanza el pipeline (calendar + standings) por cada
 * temporada sembrada, en secuencia y con pausa para no castigar la fuente.
 *
 * Idempotente: se puede relanzar; ON CONFLICT en todas las inserciones.
 *
 * Uso:
 *   npx tsx --env-file=../../.env src/import-history.ts             # solo siembra
 *   npx tsx --env-file=../../.env src/import-history.ts --run       # siembra + scrapea
 *   npx tsx --env-file=../../.env src/import-history.ts --run --only-idc=2816
 */
import { db, closeDb } from '@sports/db';
import { createLogger } from '@sports/logger';
import { readFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const log = createLogger({ service: 'import-history' });

const SPORT_SLUG = 'hockey-patines';
const SOURCE_SCRAPER_KEY = 'fep_hockey';
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CATALOG = resolve(HERE, '../../scraper/logs/fep-catalog.json');

interface CatalogTeam { logo: string; ref: string; abbr: string; name: string }
interface CatalogCompetition {
  idc: string; name: string; tempId: string | null; seasonLabel: string | null;
  logo: string | null; teamCount: number; teams: CatalogTeam[]; config: string | null;
}

// ── Normalización de nombres ──────────────────────────────────────────────────

/** Alias de patrocinador → competición canónica (las líneas principales) */
const CANONICAL: Array<{ re: RegExp; slug: string; name: string; gender: 'male' | 'female' }> = [
  { re: /^(PARLEM )?OK LIGA( MASCULINA)?$/i,            slug: 'ok-liga-masculina',  name: 'OK Liga Masculina',  gender: 'male' },
  { re: /^OK LIGA IBERDROLA$|^OK LIGA FEMENINA$/i,      slug: 'ok-liga-femenina',   name: 'OK Liga Femenina',   gender: 'female' },
  { re: /^PLAY ?OFFS? (PARLEM )?OK LIGA$/i,             slug: 'playoff-ok-liga',    name: 'Playoff OK Liga',    gender: 'male' },
  { re: /^PLAY ?OFF OK LIGA IBERDROLA$/i,               slug: 'playoff-ok-liga-femenina', name: 'Playoff OK Liga Femenina', gender: 'female' },
  { re: /^PLAY ?OUT (PARLEM )?OK LIGA$/i,               slug: 'playout-ok-liga',    name: 'Playout OK Liga',    gender: 'male' },
  { re: /^PLAY ?OFF 9 Y 10 (PARLEM )?OK LIGA$/i,        slug: 'playoff-9-10-ok-liga', name: 'Playoff 9º–10º OK Liga', gender: 'male' },
  { re: /^DIVISION DE HONOR( MASCULINA)?$/i,            slug: 'ok-liga-masculina',  name: 'OK Liga Masculina',  gender: 'male' },
];

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function inferGender(name: string): 'male' | 'female' {
  return /FEMENIN|IBERDROLA|FEMINAS|FÉMINAS/i.test(name) ? 'female' : 'male';
}

/** Categoría de edad por nomenclatura del nombre (escala cerrada de la 017) */
export function inferAgeCategory(name: string): string {
  if (/JUVENIL/i.test(name)) return 'juvenil';
  if (/JUNIOR|JÚNIOR/i.test(name)) return 'junior';
  if (/INFANTIL/i.test(name)) return 'infantil';
  if (/ALEVIN|ALEVÍN/i.test(name)) return 'alevin';
  if (/PREBENJAMIN|PRE-BENJAMIN|PREBENJAMÍN/i.test(name)) return 'prebenjamin';
  if (/BENJAMIN|BENJAMÍN/i.test(name)) return 'benjamin';
  if (/VETERAN/i.test(name)) return 'veteranos';
  if (/SUB-?\s?(15|17|19|20|23)/i.test(name)) return 'base';
  return 'senior';
}

function inferScope(name: string): 'national' | 'international' {
  return /MUNDO|MUNDIAL|EURO ?HOCKEY|EUROPEO|WORLD|GOLDEN CUP|LATIN/i.test(name)
    ? 'international' : 'national';
}

function canonical(name: string): { slug: string; name: string; gender: 'male' | 'female' } {
  const clean = name.trim().replace(/\s+/g, ' ');
  for (const c of CANONICAL) {
    if (c.re.test(clean)) return { slug: c.slug, name: c.name, gender: c.gender };
  }
  return { slug: slugify(clean), name: clean, gender: inferGender(clean) };
}

/** "Temporada 2024/25" → { name: '2024/25', slug: '2024-25', start, end } */
function seasonFields(label: string | null) {
  const m = label?.match(/(\d{4})\/(\d{2})/);
  if (!m) return { name: 'Histórico', slug: 'historico', start: null as string | null, end: null as string | null };
  const startYear = Number(m[1]);
  return {
    name: `${m[1]}/${m[2]}`,
    slug: `${m[1]}-${m[2]}`,
    start: `${startYear}-09-01`,
    end: `${startYear + 1}-06-30`,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const doRun = args.includes('--run');
  // --fichas: además de calendar+standings, scrapea las ACTAS de cada partido
  // (de ahí salen jugadores, plantillas y alineaciones). Es lento.
  const doFichas = args.includes('--fichas');
  // Acepta uno o varios idc separados por coma: --only-idc=3151,3258,3301
  const onlyIdcRaw = args.find((a) => a.startsWith('--only-idc='))?.split('=')[1] ?? null;
  const onlyIdcs = onlyIdcRaw
    ? new Set(onlyIdcRaw.split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  // Federaciones autonómicas: --catalog=<json> --org=FMP --region=Madrid
  //   (+ SIDGAD_PORTAL/SIDGAD_REFERER en el entorno para la fase --run)
  const catalogPath = args.find((a) => a.startsWith('--catalog='))?.split('=')[1] ?? DEFAULT_CATALOG;
  const organizer = args.find((a) => a.startsWith('--org='))?.split('=')[1] ?? 'RFEP';
  const region = args.find((a) => a.startsWith('--region='))?.split('=')[1] ?? null;
  const scope = region ? 'regional' : null; // si hay región, es autonómica

  const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8')) as {
    competitions: CatalogCompetition[];
  };

  const comps = catalog.competitions.filter((c) => !onlyIdcs || onlyIdcs.has(String(c.idc)));
  log.info({ total: comps.length }, 'Competiciones del catálogo a importar');

  // IDs base
  const sportRes = await db.query<{ id: string }>(`SELECT id FROM sports WHERE slug = $1`, [SPORT_SLUG]);
  const sportId = sportRes.rows[0]?.id;
  if (!sportId) throw new Error(`Deporte no encontrado: ${SPORT_SLUG}`);
  const srcRes = await db.query<{ id: string }>(`SELECT id FROM data_sources WHERE scraper_key = $1`, [SOURCE_SCRAPER_KEY]);
  const sourceId = srcRes.rows[0]?.id;
  if (!sourceId) throw new Error(`DataSource no encontrado: ${SOURCE_SCRAPER_KEY}`);

  const seeded: Array<{ seasonId: string; idc: string; label: string }> = [];
  let skipped = 0;

  // Los playoffs NO son competición propia: son una FASE de su liga (sus
  // partidos se scrapean a la temporada de la liga con --idc en run-pipeline).
  // 3481 = playoff OK Liga masc · 3484 = playoff OK Liga Iberdrola fem.
  const PLAYOFF_SEED_SKIP = new Set(['3481', '3484']);

  for (const comp of comps) {
    if (PLAYOFF_SEED_SKIP.has(String(comp.idc))) { skipped++; continue; }
    const canon = organizer === 'RFEP'
      ? canonical(comp.name)
      // Autonómicas: sin alias de patrocinador y con slug prefijado por
      // organizador para no colisionar con competiciones homónimas de
      // otras federaciones ("LIGA JUVENIL" existe en varias).
      : {
          slug: `${organizer.toLowerCase()}-${slugify(comp.name)}`,
          name: comp.name.trim().replace(/\s+/g, ' '),
          gender: inferGender(comp.name),
        };
    const season = seasonFields(comp.seasonLabel);

    // 1. Competición
    const compRes = await db.query<{ id: string }>(
      `INSERT INTO competitions
         (sport_id, name, short_name, slug, gender, category, country, source_id, source_ref, scraped_at,
          organizer, scope, region, age_category)
       VALUES ($1,$2,$3,$4,$5,'senior','ES',$6,$7,NOW(),$8,$9,$10,$11)
       ON CONFLICT (sport_id, slug) DO UPDATE SET
         age_category = EXCLUDED.age_category,
         scope = EXCLUDED.scope,
         updated_at = NOW()
       RETURNING id`,
      [sportId, canon.name, null, canon.slug, canon.gender, sourceId, comp.idc,
       organizer, scope ?? inferScope(comp.name), region, inferAgeCategory(comp.name)]
    );
    const competitionId = compRes.rows[0]!.id;

    // 2. Temporada — el idc va en source_ref: es la clave de scraping.
    //    Si ya existe una temporada con ese slug Y otro source_ref (p. ej. la
    //    2025/26 actual ya cargada), NO la pisamos: actualizamos solo si es nueva.
    // La temporada en curso (temp_39 = 2025/26) se marca como actual; el índice
    // único es POR competición, así que cada una puede tener su temporada activa.
    const isCurrent = comp.tempId === '39';
    const seasonRes = await db.query<{ id: string; source_ref: string | null }>(
      `INSERT INTO seasons
         (competition_id, name, slug, start_date, end_date, is_current, source_id, source_ref, scraped_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (competition_id, slug) DO UPDATE SET updated_at = NOW()
       RETURNING id, source_ref`,
      [competitionId, season.name, season.slug, season.start, season.end, isCurrent, sourceId, comp.idc]
    );
    const seasonId = seasonRes.rows[0]!.id;
    const existingRef = seasonRes.rows[0]!.source_ref;

    if (existingRef && existingRef !== comp.idc && existingRef !== `temp_39`) {
      // Temporada ya gestionada con otro idc (caso fusión liga+playoff actual)
      skipped++;
      continue;
    }

    // 3. Equipos del catálogo — DEDUPE POR REF FEP.
    //    Cada equipo registrado (ref único) es un equipo: un mismo ref se reutiliza
    //    en todas sus competiciones (OK Liga + Copa + Supercopa), pero clubes
    //    homónimos con refs distintos (Barça masc/fem) son equipos DISTINTOS.
    //    El slug se hace único (sufijo de género o ref) para no colisionar.
    const slugTaken = async (sl: string) =>
      (await db.query(`SELECT 1 FROM teams WHERE sport_id = $1 AND slug = $2`, [sportId, sl])).rows.length > 0;

    for (const team of comp.teams) {
      const logoUrl = team.logo && team.logo !== 'default.png'
        ? `https://sidgad.cloud/rfep/images//logos_clubes/${team.logo}`
        : null;

      // a) ¿existe ya un equipo con este ref? (source_ref o alt_source_refs)
      const found = await db.query<{ id: string }>(
        `SELECT id FROM teams
         WHERE source_ref = $1 OR $1 = ANY(COALESCE(alt_source_refs, '{}'))
         LIMIT 1`,
        [team.ref]
      );
      let teamId = found.rows[0]?.id ?? null;

      if (teamId) {
        // Reutilizamos; completamos el logo si faltaba.
        if (logoUrl) {
          await db.query(
            `UPDATE teams SET logo_url = COALESCE(logo_url, $2), updated_at = NOW() WHERE id = $1`,
            [teamId, logoUrl]
          );
        }
      } else {
        // b) equipo nuevo: slug único (sufijo por género y, si aún colisiona, por ref)
        const base = slugify(team.name);
        let candidate = base;
        if (await slugTaken(candidate)) candidate = canon.gender === 'female' ? `${base}-fem` : `${base}-m`;
        if (await slugTaken(candidate)) candidate = `${base}-${team.ref}`;
        const ins = await db.query<{ id: string }>(
          `INSERT INTO teams (sport_id, name, short_name, slug, country, logo_url, source_id, source_ref, scraped_at)
           VALUES ($1,$2,$3,$4,'ES',$5,$6,$7,NOW())
           ON CONFLICT (sport_id, slug) DO UPDATE SET updated_at = NOW()
           RETURNING id`,
          [sportId, team.name, team.abbr || null, candidate, logoUrl, sourceId, team.ref]
        );
        teamId = ins.rows[0]!.id;
      }

      await db.query(
        `INSERT INTO season_teams (season_id, team_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [seasonId, teamId]
      );
    }

    seeded.push({ seasonId, idc: comp.idc, label: `${canon.name} ${season.name}` });
  }

  log.info({ seeded: seeded.length, skipped }, '✅ Siembra completada');

  if (!doRun) {
    console.log('\nSiembra hecha. Para scrapear los datos lanza con --run');
    console.log('(calendar + standings por cada temporada, en secuencia).');
    return;
  }

  // ── Scraping secuencial ────────────────────────────────────────────────────
  // Las actas (fichas-pendientes) traen jugadores/plantillas/alineaciones; son
  // lentas (una por partido), así que solo si se pide con --fichas.
  const entities = ['calendar', 'standings', ...(doFichas ? ['fichas-pendientes'] : [])];
  console.log(`\n▶ Scrapeando ${seeded.length} temporadas (${entities.join(' + ')})...`);
  let ok = 0, fail = 0;
  for (const [i, s] of seeded.entries()) {
    console.log(`\n[${i + 1}/${seeded.length}] ${s.label} (idc=${s.idc})`);
    for (const entity of entities) {
      try {
        execSync(
          `npx tsx --env-file=../../.env src/run-pipeline.ts --entity=${entity} --idc=${s.idc} --season-id=${s.seasonId}`,
          // Las actas de una temporada entera pueden tardar bastante.
          { cwd: resolve(HERE, '..'), stdio: 'inherit', timeout: entity === 'fichas-pendientes' ? 3_600_000 : 180_000 }
        );
        ok++;
      } catch {
        console.log(`   ⚠️  ${entity} falló para idc=${s.idc} — continuando`);
        fail++;
      }
    }
    // Pausa de cortesía con la fuente
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`\n✅ Histórico scrapeado: ${ok} cargas OK, ${fail} fallos.`);
  console.log('Los fallos suelen ser competiciones antiguas sin datos en la fuente.');
}

main()
  .catch((err) => { log.error({ err }, 'Error en import-history'); process.exit(1); })
  .finally(() => closeDb());
