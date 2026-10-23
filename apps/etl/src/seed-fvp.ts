/**
 * Seed de las competiciones de la Federación Vasca de Patinaje (API DigitalSport).
 *
 * Lee el catálogo de la API (hockey patines de la temporada pedida), descarga
 * cada competición para descubrir los equipos y crea/actualiza:
 *   · competición (organizer FVP, región País Vasco, Europe/Madrid)
 *   · temporada actual
 *   · equipos (ref `fvp_{ámbito}_{slug}`, escudo del club) + su club
 *     (`fvp_club_{id}`) + season_teams
 *   · competition_sources.external_ids.fvp, que lee run-fvp.ts
 *
 * Identidad: el equipo se reutiliza SOLO por su ref FVP (la copa usa el ámbito
 * de su liga). Nunca por slug: un "C.P. Burgos" ya existente de otra fuente se
 * lista como posible duplicado para enlazarlo a mano, no se fusiona solo.
 *
 * Idempotente. Dry-run por defecto; --write para escribir. --only=key1,key2
 * limita a esas competiciones. --season=T2627 (por defecto).
 *
 *   node dist/apps/etl/src/seed-fvp.js            # dry-run
 *   node dist/apps/etl/src/seed-fvp.js --write
 */
import {
  db, closeDb, findTeamBySourceRef, findTeamBySlug, upsertCompetitionSource,
  upsertSourceEntityMapTeam, ensureClubForTeam, recordSeasonTeamRef,
} from '@sports/db';
import { createLogger } from '@sports/logger';
import {
  planFvpCatalog, competitionSourceRef, fvpTeamRef, slugify, cupAliasesByClub, FVP_TIMEZONE, FVP_SCRAPER_KEY,
  type FvpApiCompetition, type FvpCompetition,
} from '../../scraper/src/scrapers/fvp/fvp-catalog.js';
import { fvpGet, fvpPaths } from '../../scraper/src/scrapers/fvp/fvp-client.js';
import { fetchFvpCompetition } from '../../scraper/src/scrapers/fvp/fvp.scraper.js';
import { deriveShortName } from './derive-short-name.js';

const log = createLogger({ service: 'seed-fvp' });

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const ONLY = (argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const SEASON = (argv.find((a) => a.startsWith('--season=')) ?? '--season=T2627').slice(9);
const SPORT_SLUG = 'hockey-patines';

interface DiscTeam { ref: string; name: string; abbr: string | null; logoUrl: string | null; clubId: string | null }

/** Equipos (nombre crudo + club) de una competición, tal como los publica la API. */
async function rawTeams(comp: FvpCompetition): Promise<{
  rows: Awaited<ReturnType<typeof fetchFvpCompetition>>['rows'];
  standings: Awaited<ReturnType<typeof fetchFvpCompetition>>['standings'];
  list: Array<{ name: string; clubId: string | null }>;
}> {
  const { rows, standings } = await fetchFvpCompetition(comp.apiId);
  const list = [
    ...standings.flatMap((f) => f.rows.map((s) => ({ name: s.name, clubId: s.clubId }))),
    ...rows.flatMap((r) => [
      ...(r.homeName ? [{ name: r.homeName, clubId: r.homeClubId }] : []),
      ...(r.awayName ? [{ name: r.awayName, clubId: r.awayClubId }] : []),
    ]),
  ];
  return { rows, standings, list };
}

async function discover(comp: FvpCompetition, raw: Awaited<ReturnType<typeof rawTeams>>): Promise<DiscTeam[]> {
  const { rows, standings } = raw;
  const byRef = new Map<string, DiscTeam>();
  const add = (rawName: string | null, abbr: string | null, logoUrl: string | null, clubId: string | null) => {
    if (!rawName) return;
    const name = comp.nameAliases?.[rawName] ?? rawName;
    const ref = fvpTeamRef(comp.teamScope, name);
    const prev = byRef.get(ref);
    byRef.set(ref, {
      ref, name: prev?.name ?? name, abbr: prev?.abbr ?? abbr,
      logoUrl: prev?.logoUrl ?? logoUrl, clubId: prev?.clubId ?? clubId,
    });
  };
  for (const f of standings) for (const s of f.rows) add(s.name, s.abbr, s.logoUrl, s.clubId);
  for (const r of rows) {
    add(r.homeName, r.homeAbbr, r.homeLogo, r.homeClubId);
    add(r.awayName, r.awayAbbr, r.awayLogo, r.awayClubId);
  }
  return [...byRef.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s.-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

async function freeSlug(sportId: string, comp: FvpCompetition, t: DiscTeam): Promise<string> {
  const base = slugify(t.name.replace(/\./g, ''));
  const suffix = [comp.age !== 'senior' ? comp.age : null, comp.gender === 'female' ? 'femenino' : null].filter(Boolean).join('-');
  const candidates = [
    suffix ? `${base}-${suffix}` : base,
    `${base}${suffix ? `-${suffix}` : ''}-${comp.key}`,
  ];
  for (const s of candidates) if (!(await findTeamBySlug(sportId, s))) return s;
  return slugify(t.ref);
}

async function main() {
  const sport = (await db.query<{ id: string }>(`SELECT id FROM sports WHERE slug=$1`, [SPORT_SLUG])).rows[0];
  if (!sport) throw new Error(`Deporte no encontrado: ${SPORT_SLUG}`);
  const source = (await db.query<{ id: string }>(`SELECT id FROM data_sources WHERE scraper_key=$1`, [FVP_SCRAPER_KEY])).rows[0];
  if (!source) throw new Error(`DataSource ${FVP_SCRAPER_KEY} no encontrado: ¿aplicaste la migración 088?`);
  const sportId = sport.id, sourceId = source.id;

  const plan = planFvpCatalog(await fvpGet<FvpApiCompetition[]>(fvpPaths.competitions()), SEASON);
  // Ligas antes que copas: la copa se enlaza con los equipos de su liga.
  const comps = plan.competitions
    .filter((c) => ONLY.length === 0 || ONLY.includes(c.key))
    .sort((a, b) => Number(a.isCup) - Number(b.isCup));
  const leagueTeams = new Map<string, Array<{ name: string; clubId: string | null }>>();
  console.log(`\n──────── SEED FVP ${SEASON} (dry-run=${!WRITE}) · ${comps.length} competiciones ────────`);
  for (const s of plan.skipped) console.log(`  ⚠️  omitida: ${s.nombre} (${s.motivo})`);

  let created = 0, reused = 0;
  for (const comp of comps) {
    const raw = await rawTeams(comp);
    if (!comp.isCup) leagueTeams.set(comp.teamScope, raw.list);
    if (comp.isCup && comp.teamScope !== comp.key) {
      let league = leagueTeams.get(comp.teamScope);
      if (!league) {
        // --only con la copa sola: se lee su liga para poder enlazar.
        const lc = plan.competitions.find((c) => !c.isCup && c.teamScope === comp.teamScope);
        league = lc ? (await rawTeams(lc)).list : [];
      }
      comp.nameAliases = cupAliasesByClub(league, raw.list, comp.teamScope);
      for (const [from, to] of Object.entries(comp.nameAliases)) console.log(`  ↪ "${from}" en la copa = "${to}" de la liga (mismo club)`);
    }
    const teams = await discover(comp, raw);
    const existing = new Map<string, string>();
    const lookalikes = new Map<string, string>();
    for (const t of teams) {
      const found = await findTeamBySourceRef(t.ref);
      if (found) { existing.set(t.ref, found.id); continue; }
      const same = await findTeamBySlug(sportId, slugify(t.name.replace(/\./g, '')));
      // Solo avisa de equipos de OTRAS fuentes (los fvp_ de otra categoría son otro equipo).
      if (same && !(same.source_ref ?? '').startsWith('fvp_')) lookalikes.set(t.ref, `${same.name} [${same.gender ?? '·'}/${same.age_category ?? '·'}]`);
    }
    console.log(`\n${comp.name} [${comp.slug}] ${comp.gender}/${comp.age}${comp.isCup ? ' · copa' : ''} · equipos de "${comp.teamScope}"`);
    console.log(`  equipos: ${teams.length} (ya existen ${existing.size}, nuevos ${teams.length - existing.size})`);
    for (const t of teams) {
      const mark = existing.has(t.ref) ? '=' : '+';
      const dup = lookalikes.get(t.ref);
      console.log(`   ${mark} ${t.name}${dup ? `   ⚠️  posible duplicado de ${dup} (enlazar a mano si es el mismo)` : ''}`);
    }
    if (!WRITE) continue;

    const compId = (await db.query<{ id: string }>(
      `INSERT INTO competitions (sport_id, name, short_name, slug, gender, category, age_category, scope, organizer,
                                 region, country, timezone, source_id, source_ref, scraped_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'regional','FVP','País Vasco','ES',$8,$9,$10,NOW())
       ON CONFLICT (sport_id, slug) DO UPDATE SET
         name=EXCLUDED.name, short_name=EXCLUDED.short_name, gender=EXCLUDED.gender,
         category=EXCLUDED.category, age_category=EXCLUDED.age_category, organizer='FVP',
         region='País Vasco', country='ES', timezone=EXCLUDED.timezone, source_id=EXCLUDED.source_id,
         source_ref=EXCLUDED.source_ref, updated_at=NOW()
       RETURNING id`,
      [sportId, comp.name, comp.shortName, comp.slug, comp.gender, comp.age, comp.age,
       FVP_TIMEZONE, sourceId, competitionSourceRef(comp.key)],
    )).rows[0]!.id;

    await db.query(`UPDATE seasons SET is_current=FALSE WHERE competition_id=$1 AND slug<>$2`, [compId, comp.season.slug]);
    const seasonId = (await db.query<{ id: string }>(
      `INSERT INTO seasons (competition_id, name, slug, start_date, end_date, is_current, timezone, source_id, source_ref, scraped_at)
       VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7,$8,NOW())
       ON CONFLICT (competition_id, slug) DO UPDATE SET
         is_current=TRUE, start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date,
         timezone=EXCLUDED.timezone, source_ref=EXCLUDED.source_ref, updated_at=NOW()
       RETURNING id`,
      [compId, comp.season.name, comp.season.slug, comp.season.start, comp.season.end, FVP_TIMEZONE, sourceId,
       `fvp_season_${comp.season.code}_${comp.apiId}`],
    )).rows[0]!.id;

    for (const t of teams) {
      let teamId = existing.get(t.ref) ?? null;
      if (teamId) {
        await db.query(`UPDATE teams SET logo_url=COALESCE(logo_url,$2), updated_at=NOW() WHERE id=$1`, [teamId, t.logoUrl]);
        reused++;
      } else {
        const name = titleCase(t.name);
        teamId = (await db.query<{ id: string }>(
          `INSERT INTO teams (sport_id, name, short_name, slug, gender, age_category, squad_level, country,
                              logo_url, source_id, source_ref, scraped_at)
           VALUES ($1,$2,$3,$4,$5,$6,1,'ES',$7,$8,$9,NOW()) RETURNING id`,
          [sportId, name, t.abbr ?? (deriveShortName(name) || null), await freeSlug(sportId, comp, t),
           comp.gender, comp.age, t.logoUrl, sourceId, t.ref],
        )).rows[0]!.id;
        existing.set(t.ref, teamId);
        created++;
      }
      await upsertSourceEntityMapTeam(sourceId, t.ref, teamId).catch(() => {});
      if (t.clubId) {
        await ensureClubForTeam({ teamId, sourceId, clubRef: `fvp_club_${t.clubId}`, name: titleCase(t.name), crestUrl: t.logoUrl })
          .catch((err) => log.warn({ err, team: t.name }, 'No se pudo enlazar el club'));
      }
      if (!(await recordSeasonTeamRef(seasonId, teamId, t.ref))) {
        log.warn({ team: t.name, ref: t.ref }, 'Ref ya asignada a OTRO equipo en esta temporada — revisar');
      }
    }

    await upsertCompetitionSource({
      competitionId: compId,
      sourceId,
      externalIds: {
        idc: comp.apiId,
        ...(comp.isCup ? { format: 'bracket' as const } : {}),
        fvp: {
          apiId: comp.apiId, key: comp.key, teamScope: comp.teamScope, gender: comp.gender, age: comp.age, isCup: comp.isCup,
          ...(comp.nameAliases && Object.keys(comp.nameAliases).length ? { nameAliases: comp.nameAliases } : {}),
        },
      },
      isActive: true,
    });
    console.log(`  ✅ competition=${compId} season=${seasonId}`);
  }

  console.log(`\n══ ${WRITE ? `SEED FVP COMPLETADO · equipos nuevos=${created} reusados=${reused}` : '(dry-run) nada escrito — repite con --write'} ══`);
  if (WRITE) console.log('Carga inicial:  node dist/apps/scraper/src/index.js --run-once fvp\n');
}

main().catch((err) => { log.error({ err }, 'Error en seed FVP'); process.exitCode = 1; }).finally(() => closeDb());
