/**
 * IMPORTADOR DEL VOLCADO HISTÓRICO (v1 — archivo all-time del núcleo).
 *
 * Siembra en la BD el histórico curado de las competiciones NÚCLEO de la RFEP
 * (OK Liga M/F, Plata, Bronce, Copas, Supercopas, Selecciones) a partir del
 * payload `volcado-nucleo.json`, extraído y validado desde el pg_dump anterior
 * al vaciado del 16/06 (ver docs/VOLCADO_HISTORICO.md).
 *
 * ── Qué hace y qué NO ────────────────────────────────────────────────────────
 *   · Importa el RESULTADO de cada partido (marcador). NO importa eventos: el
 *     stream histórico no cuadra con el marcador en el 83% de los partidos, así
 *     que cada partido entra con event_coverage='none' (solo marcador).
 *   · NO asigna temporada: la fecha/temporada del dump no es fiable (un 40%+ de
 *     los partidos viejos están re-fechados). Cada competición cuelga de UNA
 *     temporada 'Histórico'. scheduled_at queda NULL a propósito.
 *   · PROD MANDA: los equipos se deduplican por source_ref (mismos ids FEP que
 *     prod), así que se enganchan a los equipos existentes; solo se crean los
 *     clubes antiguos que ya no están. Y cada partido lleva guarda NOT EXISTS
 *     contra matches.source_ref de prod: no se reimporta lo que prod ya tiene.
 *
 * ── Trazabilidad y reversibilidad ────────────────────────────────────────────
 *   Todo cuelga de un import_batch (kind='historic') y de la data_source
 *   'historic_dump'. Revertir el volcado entero:
 *     DELETE FROM matches WHERE import_batch_id = '<batch>';
 *     UPDATE import_batches SET status='reverted' WHERE id='<batch>';
 *   (Los equipos/competiciones creados se pueden limpiar por source_id si se
 *   quiere; los reutilizados de prod no se tocan.)
 *
 * Idempotente: ON CONFLICT DO NOTHING en todo. Relanzable sin duplicar.
 *
 * Uso (desde el portátil, por el túnel SSH contra prod — ver docs/DEPLOY.md):
 *   npx tsx --env-file=../../.env src/import-volcado.ts --dry-run   # cuenta, no escribe
 *   npx tsx --env-file=../../.env src/import-volcado.ts             # importa
 */
import { db, closeDb } from '@sports/db';
import { createLogger } from '@sports/logger';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const log = createLogger({ service: 'import-volcado' });

const SPORT_SLUG = 'hockey-patines';
const HERE = dirname(fileURLToPath(import.meta.url));
const PAYLOAD = resolve(HERE, '../../../data/volcado-nucleo.json');

interface Comp { slug: string; name: string; gender: 'male' | 'female'; age_category: string; is_new: boolean }
interface Team { key: string; name: string; ref: string | null; city: string | null }
interface Match { ref: string | null; comp: string; home: string; away: string; hs: number | null; as: number | null }
interface Payload { meta: Record<string, unknown>; competitions: Comp[]; teams: Team[]; matches: Match[] }

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const payload = JSON.parse(readFileSync(PAYLOAD, 'utf-8')) as Payload;
  log.info({ ...payload.meta, dryRun }, 'Payload del volcado cargado');

  // ── IDs base ────────────────────────────────────────────────────────────────
  const sportId = (await db.query<{ id: string }>(
    `SELECT id FROM sports WHERE slug = $1`, [SPORT_SLUG])).rows[0]?.id;
  if (!sportId) throw new Error(`Deporte no encontrado: ${SPORT_SLUG}`);

  // data_source propia del volcado (traza + revert). Idempotente por scraper_key.
  const sourceId = (await db.query<{ id: string }>(
    `INSERT INTO data_sources (name, base_url, scraper_key, provider, is_active, notes)
          VALUES ('Volcado histórico', 'https://www.rfep.es', 'historic_dump', 'sidgad', false,
                  'Import único del histórico RFEP (pg_dump pre-16/06). Solo resultado, sin temporada.')
     ON CONFLICT (scraper_key) DO UPDATE SET updated_at = NOW()
     RETURNING id`)).rows[0]!.id;

  if (dryRun) {
    log.info('DRY-RUN: no se escribe nada. Resumen de lo que entraría:');
    let yaEnProd = 0;
    for (const m of payload.matches) {
      if (!m.ref) continue;
      const ex = await db.query(`SELECT 1 FROM matches WHERE source_ref = $1`, [m.ref]);
      if (ex.rows.length) yaEnProd++;
    }
    log.info({ competiciones: payload.competitions.length, equipos: payload.teams.length,
               partidos: payload.matches.length, ya_en_prod: yaEnProd,
               a_importar: payload.matches.length - yaEnProd }, 'DRY-RUN');
    return;
  }

  // ── Lote de importación ───────────────────────────────────────────────────────
  const batchId = (await db.query<{ id: string }>(
    `INSERT INTO import_batches (source_id, label, kind, status, scope_note)
          VALUES ($1, $2, 'historic', 'running', $3)
     ON CONFLICT (label) DO UPDATE SET status='running', started_at=NOW()
     RETURNING id`,
    [sourceId, `hist-nucleo-v1`, 'Archivo all-time núcleo RFEP (sin temporada, solo marcador)'])).rows[0]!.id;

  // ── 1. Competiciones + temporada 'Histórico' ─────────────────────────────────
  const seasonByComp = new Map<string, string>();
  for (const c of payload.competitions) {
    const compId = (await db.query<{ id: string }>(
      `INSERT INTO competitions
         (sport_id, name, short_name, slug, gender, category, country, source_id, scraped_at,
          organizer, scope, region, age_category)
       VALUES ($1,$2,NULL,$3,$4,'senior','ES',$5,NOW(),'RFEP','national',NULL,$6)
       ON CONFLICT (sport_id, slug) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [sportId, c.name, c.slug, c.gender, sourceId, c.age_category])).rows[0]!.id;

    const seasonId = (await db.query<{ id: string }>(
      `INSERT INTO seasons (competition_id, name, slug, is_current, source_id, scraped_at)
            VALUES ($1, 'Histórico', 'historico', false, $2, NOW())
       ON CONFLICT (competition_id, slug) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [compId, sourceId])).rows[0]!.id;
    seasonByComp.set(c.slug, seasonId);
  }
  log.info({ n: payload.competitions.length }, 'Competiciones + temporada Histórico listas');

  // ── 2. Equipos — DEDUPE POR REF FEP (prod manda) ─────────────────────────────
  const teamByKey = new Map<string, string>();
  let teamsReused = 0, teamsNew = 0;
  const slugTaken = async (sl: string) =>
    (await db.query(`SELECT 1 FROM teams WHERE sport_id=$1 AND slug=$2`, [sportId, sl])).rows.length > 0;

  for (const t of payload.teams) {
    let teamId: string | null = null;
    if (t.ref) {
      const found = await db.query<{ id: string }>(
        `SELECT id FROM teams WHERE source_ref=$1 OR $1 = ANY(COALESCE(alt_source_refs,'{}')) LIMIT 1`,
        [t.ref]);
      teamId = found.rows[0]?.id ?? null;
    }
    if (teamId) {
      teamsReused++;
    } else {
      let cand = slugify(t.name) || `team-${t.ref ?? 'x'}`;
      if (await slugTaken(cand)) cand = `${cand}-${t.ref ?? Math.random().toString(36).slice(2, 6)}`;
      teamId = (await db.query<{ id: string }>(
        `INSERT INTO teams (sport_id, name, short_name, slug, city, country, source_id, source_ref, scraped_at)
              VALUES ($1,$2,NULL,$3,$4,'ES',$5,$6,NOW())
         ON CONFLICT (sport_id, slug) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [sportId, t.name, cand, t.city, sourceId, t.ref])).rows[0]!.id;
      teamsNew++;
    }
    teamByKey.set(t.key, teamId);
    // Traza determinista fuente→entidad (idempotente).
    if (t.ref) {
      await db.query(
        `INSERT INTO source_entity_map (source_id, source_ref, team_id)
              VALUES ($1,$2,$3) ON CONFLICT (source_id, source_ref) DO NOTHING`,
        [sourceId, t.ref, teamId]);
    }
  }
  log.info({ reutilizados: teamsReused, nuevos: teamsNew }, 'Equipos resueltos');

  // ── 3. Partidos — solo marcador, sin temporada, guarda contra prod ───────────
  let ins = 0, skipProd = 0, skipDup = 0, skipTeam = 0;
  for (const m of payload.matches) {
    const home = teamByKey.get(m.home), away = teamByKey.get(m.away);
    if (!home || !away || home === away) { skipTeam++; continue; }
    const seasonId = seasonByComp.get(m.comp);
    if (!seasonId) { skipTeam++; continue; }

    // PROD MANDA: si prod ya tiene esta acta (mismo ref FEP), no la reimportamos.
    if (m.ref) {
      const inProd = await db.query(
        `SELECT 1 FROM matches WHERE source_ref = $1 AND import_batch_id IS NULL`, [m.ref]);
      if (inProd.rows.length) { skipProd++; continue; }
    }

    const status = (m.hs != null && m.as != null) ? 'finished' : 'postponed';
    const r = await db.query(
      `INSERT INTO matches
         (season_id, home_team_id, away_team_id, home_score, away_score, status,
          scheduled_at, source_id, source_ref, event_coverage, import_batch_id, scraped_at)
       VALUES ($1,$2,$3,$4,$5,$6, NULL, $7, $8, 'none', $9, NOW())
       ON CONFLICT (source_ref) WHERE source_ref IS NOT NULL DO NOTHING`,
      [seasonId, home, away, m.hs, m.as, status, sourceId, m.ref, batchId]);
    if (r.rowCount && r.rowCount > 0) ins++; else skipDup++;
  }

  await db.query(
    `UPDATE import_batches
        SET status='completed', finished_at=NOW(),
            stats = $2::jsonb
      WHERE id = $1`,
    [batchId, JSON.stringify({ matches_inserted: ins, skipped_in_prod: skipProd,
      skipped_dup: skipDup, skipped_team: skipTeam, teams_reused: teamsReused, teams_new: teamsNew })]);

  log.info({ insertados: ins, ya_en_prod: skipProd, duplicados: skipDup, sin_equipo: skipTeam,
             batch: batchId }, '✅ Volcado completado');
}

main()
  .catch((err) => { log.error({ err }, 'Error en import-volcado'); process.exit(1); })
  .finally(() => closeDb());
