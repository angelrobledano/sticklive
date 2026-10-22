/**
 * A4 — Backfill de clubes por escudo (id de club sidgad).
 *
 * `clubs` se rellenó una sola vez (03/08, 1:1 con los equipos de entonces) y
 * nada lo alimentó después: Calafell es hoy cinco equipos, cuatro sin club. El
 * nombre comercial cambia con el patrocinador, pero el escudo no: su fichero
 * (`logos_clubes/calafell.png`) es el id de club sidgad.
 *
 *   · Agrupa los equipos por `{portal}_club_{clave del escudo}`.
 *   · Con `--write`, cuelga del club del grupo a los equipos que no tienen
 *     club (`ensureClubForTeam`: nunca reasigna uno que ya lo tiene).
 *   · Si el grupo ya tiene VARIOS clubes (artefacto del backfill 1:1), lo
 *     informa como candidato a fusión. Solo con `--merge-clubs` los une: mueve
 *     equipos, nombres y refs al club del mapa y borra el club vacío.
 *
 *   npx tsx apps/etl/src/backfill-clubs-by-crest.ts                       # dry-run
 *   npx tsx apps/etl/src/backfill-clubs-by-crest.ts --write
 *   npx tsx apps/etl/src/backfill-clubs-by-crest.ts --write --merge-clubs
 *
 * Revisar el dry-run antes: un escudo genérico compartido por clubes distintos
 * agruparía mal (los conocidos ya se descartan en clubKeyFromLogo).
 */
import { fileURLToPath } from 'node:url';
import { db, withTransaction, closeDb, ensureClubForTeam } from '@sports/db';
import { createLogger } from '@sports/logger';
import { clubKeyFromLogo } from '../../scraper/src/core/sidgad-club.js';
import { sourceForPortal, clubRef } from '../../scraper/src/core/sources.js';

const log = createLogger({ service: 'backfill-clubs-by-crest' });

export interface CrestGroup { clubRef: string; teamIds: string[]; names: string[]; clubIds: string[] }
export interface CrestBackfillResult {
  groups: CrestGroup[];
  linked: number;
  mergeCandidates: { clubRef: string; clubIds: string[] }[];
  merged: number;
}

/** `https://sidgad.cloud/rfep/images/logos_clubes/x.png` → `fep_club_x` (null si no se reconoce). */
function clubRefFromLogoUrl(url: string | null): string | null {
  const key = clubKeyFromLogo(url);
  const portal = /sidgad\.(?:cloud|com)\/([a-z]+)\/images\//.exec(url ?? '')?.[1];
  if (!key || !portal) return null;
  try { return clubRef(sourceForPortal(portal), key); } catch { return null; }
}

export async function backfillClubsByCrest(opts: { write: boolean; mergeClubs?: boolean }): Promise<CrestBackfillResult> {
  const { rows: teams } = await db.query<{ id: string; name: string; logo_url: string | null; club_id: string | null }>(
    `SELECT id, name, logo_url, club_id FROM teams WHERE logo_url IS NOT NULL ORDER BY created_at, id`,
  );
  const byRef = new Map<string, CrestGroup>();
  for (const t of teams) {
    const ref = clubRefFromLogoUrl(t.logo_url);
    if (!ref) continue;
    const g = byRef.get(ref) ?? { clubRef: ref, teamIds: [], names: [], clubIds: [] };
    g.teamIds.push(t.id);
    g.names.push(t.name);
    if (t.club_id && !g.clubIds.includes(t.club_id)) g.clubIds.push(t.club_id);
    byRef.set(ref, g);
  }
  const groups = [...byRef.values()];
  const mergeCandidates = groups.filter((g) => g.clubIds.length > 1).map((g) => ({ clubRef: g.clubRef, clubIds: g.clubIds }));
  for (const g of groups.filter((x) => x.teamIds.length > 1)) log.info(g, 'Grupo de club por escudo');
  for (const m of mergeCandidates) log.warn(m, 'Varios clubes con el mismo escudo: candidato a fusión');

  const result: CrestBackfillResult = { groups, linked: 0, mergeCandidates, merged: 0 };
  if (!opts.write) return result;

  const source = (await db.query<{ id: string }>(`SELECT id FROM data_sources WHERE scraper_key = 'fep_hockey'`)).rows[0];
  if (!source) throw new Error('data_sources.fep_hockey no existe');

  for (const g of groups) {
    await withTransaction(async (client) => {
      // Primero los que ya tienen club: así la ref se aprende hacia SU club.
      const conClub = await client.query<{ id: string; name: string; club_id: string | null }>(
        `SELECT id, name, club_id FROM teams WHERE id = ANY($1) ORDER BY (club_id IS NULL), created_at, id`, [g.teamIds],
      );
      for (const t of conClub.rows) {
        const before = t.club_id;
        await ensureClubForTeam({ teamId: t.id, sourceId: source.id, clubRef: g.clubRef, name: t.name, client });
        if (!before) result.linked++;
      }

      if (opts.mergeClubs && g.clubIds.length > 1) {
        const target = (await client.query<{ club_id: string }>(
          `SELECT club_id FROM source_entity_map WHERE source_id = $1 AND source_ref = $2`, [source.id, g.clubRef],
        )).rows[0]!.club_id;
        for (const other of g.clubIds.filter((c) => c !== target)) {
          await client.query(`UPDATE teams SET club_id = $1, updated_at = NOW() WHERE club_id = $2`, [target, other]);
          await client.query(
            `INSERT INTO club_names (club_id, commercial_name, sponsor_id, valid_from, valid_to)
             SELECT $1, commercial_name, sponsor_id, valid_from, valid_to FROM club_names WHERE club_id = $2
             ON CONFLICT (club_id, commercial_name, valid_from) DO NOTHING`, [target, other],
          );
          await client.query(`DELETE FROM club_names WHERE club_id = $1`, [other]);
          await client.query(`UPDATE source_entity_map SET club_id = $1 WHERE club_id = $2`, [target, other]);
          await client.query(`DELETE FROM clubs WHERE id = $1`, [other]);
          result.merged++;
        }
      }
    });
  }
  log.info({ groups: groups.length, linked: result.linked, merged: result.merged }, 'Backfill por escudo terminado');
  return result;
}

/**
 * Rellena `teams.gender`/`age_category` vacíos cuando TODAS las competiciones
 * en las que participa el equipo (inscripción o partidos) dicen lo mismo. Si
 * hay mezcla (un equipo mal fusionado, por ejemplo) no se toca: es revisión.
 */
export async function fillSectionFromCompetitions(opts: { write: boolean }): Promise<number> {
  const sql = `
    WITH participa AS (
      SELECT team_id, season_id FROM season_teams
      UNION SELECT home_team_id, season_id FROM matches
      UNION SELECT away_team_id, season_id FROM matches
    ), firma AS (
      SELECT p.team_id,
             count(DISTINCT c.gender) AS ng, max(c.gender) AS gender,
             count(DISTINCT c.age_category) AS na, max(c.age_category) AS age_category,
             bool_or(c.gender IS NULL OR c.age_category IS NULL) AS incompleta
        FROM participa p
        JOIN seasons s ON s.id = p.season_id
        JOIN competitions c ON c.id = s.competition_id
       GROUP BY p.team_id
    )
    ${opts.write ? 'UPDATE teams t SET gender = f.gender, age_category = f.age_category, updated_at = NOW() FROM firma f' : 'SELECT t.id FROM teams t JOIN firma f ON TRUE'}
     WHERE f.team_id = t.id AND t.gender IS NULL AND t.age_category IS NULL
       AND f.ng = 1 AND f.na = 1 AND NOT f.incompleta`;
  const r = await db.query(sql);
  return r.rowCount ?? 0;
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const mergeClubs = process.argv.includes('--merge-clubs');
  const secciones = await fillSectionFromCompetitions({ write });
  console.log(`${secciones} equipos ${write ? 'con' : 'recibirían'} género/categoría desde sus competiciones`);
  const r = await backfillClubsByCrest({ write, mergeClubs });
  console.log(`${r.groups.length} claves de club, ${r.groups.filter((g) => g.teamIds.length > 1).length} con varios equipos, `
    + `${r.mergeCandidates.length} candidatos a fusión de clubes`
    + (write ? `. Enlazados ${r.linked}, fusionados ${r.merged}.` : ' (dry-run: repite con --write)'));
}

const esEjecucionDirecta = process.argv[1] === fileURLToPath(import.meta.url);
if (esEjecucionDirecta) {
  main()
    .catch((err) => { log.error({ err }, 'Error fatal en backfill por escudo'); process.exit(1); })
    .finally(() => closeDb());
}
