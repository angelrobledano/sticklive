/**
 * Seed de las competiciones de la FPP (Portugal) — temporada 2026/27.
 *
 * Lee el catálogo (apps/scraper/src/scrapers/fpp/fpp-catalog.ts), descarga
 * cada sección de hp.fpp.pt para descubrir los equipos y crea/actualiza:
 *   · competición (country PT, organizer FPP, timezone Europe/Lisbon)
 *   · temporada actual (timezone Europe/Lisbon)
 *   · equipos (ref de sección `fpp_{m|f}_{edad}_{slug}`, escudo de la tabla)
 *     + su club (`fpp_club_{id}`, del escudo CLUBE_{id}.png) + season_teams
 *   · competition_sources.external_ids.fpp (secciones), que lee run-fpp.ts
 *
 * Identidad: el mismo equipo en liga y copas se reutiliza por la ref de
 * sección (global y única). Un slug que ya usa OTRO equipo (p. ej. un club
 * español homónimo) se desambigua con sufijos; nunca se reutiliza por slug.
 *
 * Idempotente. Dry-run por defecto; --write para escribir. --only=key1,key2
 * limita a esas competiciones del catálogo.
 *
 *   node dist/apps/etl/src/seed-fpp.js            # dry-run
 *   node dist/apps/etl/src/seed-fpp.js --write
 */
import {
  db, closeDb, findTeamBySourceRef, findTeamBySlug, upsertCompetitionSource,
  upsertSourceEntityMapTeam, ensureClubForTeam, recordSeasonTeamRef,
} from '@sports/db';
import { createLogger } from '@sports/logger';
import {
  FPP_COMPETITIONS, FPP_SEASON, FPP_TIMEZONE, competitionSourceRef, fppTeamRef,
  type FppCompetition,
} from '../../scraper/src/scrapers/fpp/fpp-catalog.js';
import { fetchFppSections } from '../../scraper/src/scrapers/fpp/fpp.scraper.js';
import { isPlaceholderTeam } from '../../scraper/src/scrapers/fpp/fpp.parser.js';
import { deriveShortName } from './derive-short-name.js';

const log = createLogger({ service: 'seed-fpp' });

const args = new Set(process.argv.slice(2));
const WRITE = args.has('--write');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);

const SPORT_SLUG = 'hockey-patines';
const SOURCE_KEY = 'fpp_hockey';

function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

interface DiscTeam { ref: string; name: string; logoUrl: string | null; clubId: string | null }

/** Equipos de la competición: calendario (todos) + clasificación (escudo y club). */
async function discover(comp: FppCompetition): Promise<DiscTeam[]> {
  const sections = await fetchFppSections(comp);
  const byRef = new Map<string, DiscTeam>();
  const add = (name: string, logoUrl: string | null = null, clubId: string | null = null) => {
    if (isPlaceholderTeam(name)) return;
    const ref = fppTeamRef(comp.gender, comp.teamAge, name);
    const prev = byRef.get(ref);
    byRef.set(ref, { ref, name, logoUrl: prev?.logoUrl ?? logoUrl, clubId: prev?.clubId ?? clubId });
  };
  for (const s of sections) {
    for (const st of s.standings) add(st.name, st.logoUrl, st.clubId);
    for (const r of s.calendar) { add(r.homeName); add(r.awayName); }
  }
  return [...byRef.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function freeSlug(sportId: string, comp: FppCompetition, t: DiscTeam): Promise<string> {
  const base = slugify(t.name);
  const candidates = [
    comp.gender === 'male' && comp.teamAge === 'senior' ? base : null,
    `${base}${comp.teamAge !== 'senior' ? `-${comp.teamAge.replace('sub', 'sub-')}` : ''}${comp.gender === 'female' ? '-femenino' : ''}`,
    `${base}-pt`,
    `${base}${comp.gender === 'female' ? '-f' : '-m'}-${comp.teamAge}-pt`,
  ].filter((s): s is string => !!s);
  for (const s of candidates) if (!(await findTeamBySlug(sportId, s))) return s;
  return `${slugify(t.ref)}`;
}

async function main() {
  const sport = (await db.query<{ id: string }>(`SELECT id FROM sports WHERE slug=$1`, [SPORT_SLUG])).rows[0];
  if (!sport) throw new Error(`Deporte no encontrado: ${SPORT_SLUG}`);
  const source = (await db.query<{ id: string }>(`SELECT id FROM data_sources WHERE scraper_key=$1`, [SOURCE_KEY])).rows[0];
  if (!source) throw new Error(`DataSource ${SOURCE_KEY} no encontrado: ¿aplicaste la migración 087?`);
  const sportId = sport.id, sourceId = source.id;

  const comps = FPP_COMPETITIONS.filter((c) => ONLY.length === 0 || ONLY.includes(c.key));
  console.log(`\n──────── SEED FPP ${FPP_SEASON.name} (dry-run=${!WRITE}) · ${comps.length} competiciones ────────`);

  let created = 0, reused = 0;
  for (const comp of comps) {
    const teams = await discover(comp);
    const existing = new Map<string, string>();
    for (const t of teams) {
      const found = await findTeamBySourceRef(t.ref);
      if (found) existing.set(t.ref, found.id);
    }
    console.log(`\n${comp.name} [${comp.slug}] ${comp.gender}/${comp.teamAge} · ${comp.format} · ids ${comp.sections.map((s) => s.fppId + (s.group ? `(${s.group})` : '')).join(', ')}`);
    console.log(`  equipos: ${teams.length} (ya existen ${existing.size}, nuevos ${teams.length - existing.size})`);
    for (const t of teams) console.log(`   ${existing.has(t.ref) ? '=' : '+'} ${t.name}${t.clubId ? ` [club ${t.clubId}]` : ''}`);
    if (!WRITE) continue;

    const compId = (await db.query<{ id: string }>(
      `INSERT INTO competitions (sport_id, name, short_name, slug, gender, category, age_category, scope, organizer,
                                 country, timezone, source_id, source_ref, scraped_at, logo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'national','FPP','PT',$8,$9,$10,NOW(),$11)
       ON CONFLICT (sport_id, slug) DO UPDATE SET
         name=EXCLUDED.name, short_name=EXCLUDED.short_name, gender=EXCLUDED.gender,
         category=EXCLUDED.category, age_category=EXCLUDED.age_category, organizer='FPP', country='PT',
         timezone=EXCLUDED.timezone, source_id=EXCLUDED.source_id, source_ref=EXCLUDED.source_ref,
         logo_url=COALESCE(EXCLUDED.logo_url, competitions.logo_url), updated_at=NOW()
       RETURNING id`,
      [sportId, comp.name, comp.shortName, comp.slug, comp.gender, comp.teamAge, comp.competitionAge,
       FPP_TIMEZONE, sourceId, competitionSourceRef(comp.key),
       comp.logo ? `${process.env['PUBLIC_WEB_URL'] ?? 'https://sticklive.eu'}/competiciones/${comp.logo}` : null],
    )).rows[0]!.id;

    await db.query(`UPDATE seasons SET is_current=FALSE WHERE competition_id=$1 AND slug<>$2`, [compId, FPP_SEASON.slug]);
    const seasonId = (await db.query<{ id: string }>(
      `INSERT INTO seasons (competition_id, name, slug, start_date, end_date, is_current, timezone, source_id, source_ref, scraped_at)
       VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7,$8,NOW())
       ON CONFLICT (competition_id, slug) DO UPDATE SET
         is_current=TRUE, start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date,
         timezone=EXCLUDED.timezone, source_ref=EXCLUDED.source_ref, updated_at=NOW()
       RETURNING id`,
      [compId, FPP_SEASON.name, FPP_SEASON.slug, FPP_SEASON.start, FPP_SEASON.end, FPP_TIMEZONE, sourceId,
       `fpp_season_${FPP_SEASON.epoca}_${comp.key}`],
    )).rows[0]!.id;

    for (const t of teams) {
      let teamId = existing.get(t.ref) ?? null;
      if (teamId) {
        await db.query(
          `UPDATE teams SET logo_url=COALESCE(logo_url,$2), updated_at=NOW() WHERE id=$1`, [teamId, t.logoUrl],
        );
        reused++;
      } else {
        const slug = await freeSlug(sportId, comp, t);
        teamId = (await db.query<{ id: string }>(
          `INSERT INTO teams (sport_id, name, short_name, slug, gender, age_category, squad_level, country,
                              logo_url, source_id, source_ref, scraped_at)
           VALUES ($1,$2,$3,$4,$5,$6,1,'PT',$7,$8,$9,NOW()) RETURNING id`,
          [sportId, t.name, deriveShortName(t.name) || null, slug, comp.gender, comp.teamAge, t.logoUrl, sourceId, t.ref],
        )).rows[0]!.id;
        existing.set(t.ref, teamId);
        created++;
      }
      await upsertSourceEntityMapTeam(sourceId, t.ref, teamId).catch(() => {});
      if (t.clubId) {
        await ensureClubForTeam({ teamId, sourceId, clubRef: `fpp_club_${t.clubId}`, name: t.name, crestUrl: t.logoUrl })
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
        idc: comp.sections[0]!.fppId,
        ...(comp.format !== 'league' ? { format: comp.format } : {}),
        fpp: { key: comp.key, gender: comp.gender, teamAge: comp.teamAge, sections: comp.sections },
      },
      isActive: true,
    });
    console.log(`  ✅ competition=${compId} season=${seasonId}`);
  }

  console.log(`\n══ ${WRITE ? `SEED FPP COMPLETADO · equipos nuevos=${created} reusados=${reused}` : '(dry-run) nada escrito — repite con --write'} ══`);
  if (WRITE) console.log('Carga inicial:  node dist/apps/scraper/src/index.js --run-once fpp\n');
}

main().catch((err) => { log.error({ err }, 'Error en seed FPP'); process.exitCode = 1; }).finally(() => closeDb());
