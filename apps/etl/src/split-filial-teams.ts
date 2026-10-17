/**
 * Reparación one-off: separar filiales conflados con su primer equipo.
 *
 * Causa: el seed resolvía un ref nuevo por SLUG (regla del proyecto: resolver
 * por REFERENCIA, nunca por nombre), así que dos equipos del mismo club con el
 * mismo nombre — el primer equipo en una liga y su filial en otra — acabaron
 * siendo la misma fila `teams`. Efecto: la ficha del primer equipo listaba las
 * dos ligas y la clasificación de la liga inferior mostraba a ese equipo.
 *
 * Este script, por cada caso del MAPPING:
 *   · crea el filial (nombre + " B", squad_level=2, slug único, source_ref = su ref),
 *   · mueve a él los partidos, la clasificación y la plaza de temporada de la
 *     liga INFERIOR,
 *   · quita esa ref de `alt_source_refs` del primer equipo y repunta el
 *     `source_entity_map`.
 *
 * Dry-run por defecto; `--write` aplica; `--revert` deshace. Idempotente.
 *
 *   node dist/apps/etl/src/split-filial-teams.js            # dry-run
 *   node dist/apps/etl/src/split-filial-teams.js --write
 *   node dist/apps/etl/src/split-filial-teams.js --revert --write
 */
import { db, closeDb, withTransaction, recordEntityRedirect } from '@sports/db';
import { createLogger } from '@sports/logger';
import { slugify } from './transformers/slugify.js';

const log = createLogger({ service: 'split-filial-teams' });

const argv = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.length ? v.join('=') : 'true'];
  }),
) as Record<string, string>;
const WRITE = argv['write'] === 'true' || argv['write'] === '1';
const REVERT = argv['revert'] === 'true' || argv['revert'] === '1';

interface Caso {
  /** source_ref del primer equipo (el que se queda con la liga superior). */
  equipoRef: string;
  nombre: string;
  /** Competición de la liga INFERIOR: ahí debe vivir el filial. */
  competicionFilial: string;
  /** Ref de la fuente con la que esa liga inferior nombra al filial. */
  refFilial: string;
  gender: string;
  ageCategory: string;
}

const MAPPING: Caso[] = [
  { equipoRef: '3387', nombre: 'CE NOIA FREIXENET',      competicionFilial: 'ok-liga-plata-sur',      refFilial: '3685', gender: 'male', ageCategory: 'senior' },
  { equipoRef: '3332', nombre: 'REUS DEPORTIU BRASILIA', competicionFilial: 'ok-liga-plata-norte',    refFilial: '3712', gender: 'male', ageCategory: 'senior' },
  { equipoRef: '3374', nombre: 'ADISS HOCKEY RIVAS',     competicionFilial: 'ok-liga-bronce-masculina-sur', refFilial: '3739', gender: 'male', ageCategory: 'senior' },
  { equipoRef: '3089', nombre: 'ACORDES',                competicionFilial: 'ok-liga-bronce-masculina-norte', refFilial: '3673', gender: 'male', ageCategory: 'senior' },
  { equipoRef: '3407', nombre: 'CDM HOCKEY PATINES',     competicionFilial: 'ok-liga-bronce-masculina-norte', refFilial: '3714', gender: 'male', ageCategory: 'senior' },
  { equipoRef: '3376', nombre: 'CLUB PATIN ALCOBENDAS',  competicionFilial: 'ok-liga-bronce-masculina-sur', refFilial: '3735', gender: 'male', ageCategory: 'senior' },
  { equipoRef: '3373', nombre: 'HOCKEY CLUB LICEO',      competicionFilial: 'ok-liga-bronce-masculina-norte', refFilial: '3744', gender: 'male', ageCategory: 'senior' },
];

async function seasonOf(compSlug: string): Promise<{ competitionId: string; seasonId: string } | null> {
  const r = await db.query<{ competition_id: string; season_id: string }>(
    `SELECT c.id AS competition_id, s.id AS season_id
       FROM competitions c JOIN seasons s ON s.competition_id = c.id
      WHERE c.slug = $1 AND s.is_current
      LIMIT 1`,
    [compSlug],
  );
  const row = r.rows[0];
  return row ? { competitionId: row.competition_id, seasonId: row.season_id } : null;
}

async function aplicar(c: Caso): Promise<void> {
  const a = (await db.query<{ id: string; sport_id: string; source_id: string | null; country: string }>(
    `SELECT id, sport_id, source_id, country FROM teams WHERE source_ref = $1 LIMIT 1`,
    [c.equipoRef],
  )).rows[0];
  if (!a) { console.log(`… ${c.nombre}: primer equipo (ref ${c.equipoRef}) no encontrado, se salta`); return; }

  const target = await seasonOf(c.competicionFilial);
  if (!target) { console.log(`… ${c.nombre}: temporada actual de ${c.competicionFilial} no encontrada, se salta`); return; }

  const ya = (await db.query<{ id: string }>(`SELECT id FROM teams WHERE source_ref = $1 LIMIT 1`, [c.refFilial])).rows[0];

  if (!REVERT && ya) { console.log(`… ${c.nombre}: filial ya existe (${ya.id}), se salta`); return; }

  if (REVERT) {
    if (!ya) { console.log(`… ${c.nombre}: nada que revertir (no hay filial con ref ${c.refFilial})`); return; }
    if (!WRITE) { console.log(`~ ${c.nombre}: revertiría partidos/clasificación de ${c.competicionFilial} al primer equipo y borraría el filial`); return; }
    await withTransaction(async (tx) => {
      await tx.query(`UPDATE matches SET home_team_id = $1 WHERE season_id = $2 AND home_team_id = $3`, [a.id, target.seasonId, ya.id]);
      await tx.query(`UPDATE matches SET away_team_id = $1 WHERE season_id = $2 AND away_team_id = $3`, [a.id, target.seasonId, ya.id]);
      await tx.query(`UPDATE standings SET team_id = $1 WHERE season_id = $2 AND team_id = $3`, [a.id, target.seasonId, ya.id]);
      await tx.query(`DELETE FROM season_teams WHERE season_id = $1 AND team_id = $2`, [target.seasonId, ya.id]);
      await tx.query(`UPDATE teams SET alt_source_refs = array_append(alt_source_refs, $2) WHERE id = $1 AND NOT ($2 = ANY(alt_source_refs))`, [a.id, c.refFilial]);
      await tx.query(`UPDATE source_entity_map SET team_id = $1 WHERE team_id = $2 AND source_ref = $3`, [a.id, ya.id, c.refFilial]);
      await tx.query(`DELETE FROM teams WHERE id = $1`, [ya.id]);
      // La ficha del filial revertido redirige al primer equipo (F1-7).
      await recordEntityRedirect('team', ya.id, a.id, 'merged', tx);
    });
    console.log(`✓ ${c.nombre}: revertido (el filial ${c.refFilial} vuelve a colgar del primer equipo)`);
    return;
  }

  // Slug único para el filial.
  let slug = `${slugify(c.nombre)}-b`;
  const taken = (await db.query<{ id: string }>(`SELECT id FROM teams WHERE sport_id = $1 AND slug = $2`, [a.sport_id, slug])).rows[0];
  if (taken) slug = `${slug}-${c.refFilial}`;

  const partidos = (await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM matches WHERE season_id = $1 AND (home_team_id = $2 OR away_team_id = $2)`,
    [target.seasonId, a.id],
  )).rows[0]!.n;
  const clasif = (await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM standings WHERE season_id = $1 AND team_id = $2`,
    [target.seasonId, a.id],
  )).rows[0]!.n;

  console.log(`→ ${c.nombre} → filial "${c.nombre} B" (slug ${slug}, ref ${c.refFilial}, squad_level 2) en ${c.competicionFilial}: ${partidos} partidos, ${clasif} fila(s) de clasificación`);
  if (!WRITE) return;

  await withTransaction(async (tx) => {
    const filial = (await tx.query<{ id: string }>(
      `INSERT INTO teams (sport_id, name, short_name, slug, gender, age_category, squad_level, country, source_id, source_ref, scraped_at)
       VALUES ($1,$2,$3,$4,$5,$6,2,$7,$8,$9,NOW()) RETURNING id`,
      [a.sport_id, `${c.nombre} B`, null, slug, c.gender, c.ageCategory, a.country, a.source_id, c.refFilial],
    )).rows[0]!;

    await tx.query(`UPDATE matches SET home_team_id = $1 WHERE season_id = $2 AND home_team_id = $3`, [filial.id, target.seasonId, a.id]);
    await tx.query(`UPDATE matches SET away_team_id = $1 WHERE season_id = $2 AND away_team_id = $3`, [filial.id, target.seasonId, a.id]);
    await tx.query(`UPDATE standings SET team_id = $1 WHERE season_id = $2 AND team_id = $3`, [filial.id, target.seasonId, a.id]);
    await tx.query(`INSERT INTO season_teams (season_id, team_id) VALUES ($1,$2) ON CONFLICT (season_id, team_id) DO NOTHING`, [target.seasonId, filial.id]);
    await tx.query(`DELETE FROM season_teams WHERE season_id = $1 AND team_id = $2`, [target.seasonId, a.id]);
    await tx.query(`UPDATE teams SET alt_source_refs = array_remove(alt_source_refs, $2) WHERE id = $1`, [a.id, c.refFilial]);
    await tx.query(`UPDATE source_entity_map SET team_id = $1 WHERE team_id = $2 AND source_ref = $3`, [filial.id, a.id, c.refFilial]);
  });
  console.log(`✓ ${c.nombre}: filial creado y movido`);
}

async function main() {
  console.log(`── split-filial-teams (${REVERT ? 'REVERT' : 'aplicar'}, ${WRITE ? 'ESCRIBE' : 'dry-run'}) ──`);
  for (const c of MAPPING) await aplicar(c);
  console.log('── fin ──');
}

main().catch((err) => { log.error({ err }, 'Error en split-filial-teams'); process.exit(1); }).finally(() => closeDb());
