/**
 * A2 — Separa jugadores fusionados por colisión de ids entre portales sidgad.
 *
 * Hasta la 081 todas las actas producían `fep_player_{id}`, y el alta buscaba
 * por esa ref: el 4716 de RFEP (Pol Galbas) y el 4716 de World Skate (otra
 * persona) quedaron en la MISMA fila. La 081 renombra a los jugadores de un
 * solo portal y deja a éstos con apariciones en varios. Aquí se separan:
 *
 *   · se conserva la fila para el portal RFEP (`fep`) si aparece, si no el
 *     primero por orden alfabético,
 *   · por cada otro portal se crea una persona `{portal}_player_{id}` con el
 *     nombre de SUS alineaciones, y se le mueven plantillas, alineaciones y
 *     eventos de las competiciones de ese portal.
 *
 * Seguro por defecto: sin `--write` solo informa. Cada jugador va en su propia
 * transacción. Lo que NO separa: fusiones dentro de un mismo portal (no hay
 * criterio determinista), que se listan en la consulta V2 del análisis.
 *
 *   npx tsx apps/etl/src/split-merged-players.ts            # dry-run
 *   npx tsx apps/etl/src/split-merged-players.ts --write    # aplica
 */
import { fileURLToPath } from 'node:url';
import { db, withTransaction, closeDb } from '@sports/db';
import { createLogger } from '@sports/logger';

const log = createLogger({ service: 'split-merged-players' });

export interface SplitCandidate {
  playerId: string;
  sourceRef: string;
  name: string;
  keep: string;
  split: string[];
}

export interface SplitResult {
  candidates: SplitCandidate[];
  created: number;
}

/** Reparte "APELLIDOS NOMBRE" con la última palabra como nombre (como splitPlayerName sin marca). */
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.replace(/\s+/g, ' ').trim().split(' ');
  return parts.length > 1
    ? { firstName: parts[parts.length - 1]!, lastName: parts.slice(0, -1).join(' ') }
    : { firstName: full, lastName: full };
}

/**
 * Portal "cubierto": la persona ya tiene registrada una ref de ese portal en
 * player_source_refs (B1). Es la MISMA persona enlazada a propósito (p. ej. un
 * jugador de OK Liga y Lliga Catalana, enlazado en /admin), no una fusión por
 * colisión de ids. Solo los portales NO cubiertos se separan.
 */
const COVERED = `EXISTS (SELECT 1 FROM player_source_refs r
                  WHERE r.player_id = p.id AND r.source_ref LIKE a.portal || '\\_player\\_%')`;

const PORTALS_SQL = `
  WITH comp AS (
    SELECT c.id, competition_portal_key(c.organizer, c.source_ref) AS portal FROM competitions c
  ), apariciones AS (
    SELECT tp.player_id, comp.portal
      FROM team_players tp JOIN seasons s ON s.id = tp.season_id JOIN comp ON comp.id = s.competition_id
    UNION
    SELECT ml.player_id, comp.portal
      FROM match_lineups ml JOIN matches m ON m.id = ml.match_id
      JOIN seasons s ON s.id = m.season_id JOIN comp ON comp.id = s.competition_id
     WHERE ml.player_id IS NOT NULL
    UNION
    SELECT e.player_id, comp.portal
      FROM match_events e JOIN matches m ON m.id = e.match_id
      JOIN seasons s ON s.id = m.season_id JOIN comp ON comp.id = s.competition_id
     WHERE e.player_id IS NOT NULL
  )
  SELECT p.id, p.source_ref, p.first_name || ' ' || p.last_name AS name,
         array_agg(DISTINCT a.portal ORDER BY a.portal) AS portals,
         array_agg(DISTINCT a.portal ORDER BY a.portal) FILTER (WHERE NOT ${COVERED}) AS uncovered
    FROM players p JOIN apariciones a ON a.player_id = p.id
   WHERE p.source_ref LIKE 'fep\\_player\\_%'
   GROUP BY p.id
  HAVING count(DISTINCT a.portal) > 1
     AND count(*) FILTER (WHERE NOT ${COVERED}) > 0`;

/** Condición SQL "el partido $alias pertenece a una competición del portal $n". */
const matchInPortal = (alias: string, param: string) => `
  EXISTS (SELECT 1 FROM matches mm JOIN seasons ss ON ss.id = mm.season_id
           JOIN competitions cc ON cc.id = ss.competition_id
          WHERE mm.id = ${alias}.match_id
            AND competition_portal_key(cc.organizer, cc.source_ref) = ${param})`;

export async function splitMergedPlayers(opts: { write: boolean }): Promise<SplitResult> {
  const { rows } = await db.query<{ id: string; source_ref: string; name: string; portals: string[]; uncovered: string[] }>(PORTALS_SQL);
  const candidates: SplitCandidate[] = rows.map((r) => {
    const keep = r.portals.includes('fep') ? 'fep' : r.portals[0]!;
    return { playerId: r.id, sourceRef: r.source_ref, name: r.name, keep, split: r.uncovered.filter((p) => p !== keep) };
  }).filter((c) => c.split.length > 0);

  for (const c of candidates) log.info(c, opts.write ? 'Separando jugador fusionado' : '(dry-run) Jugador fusionado');
  if (!opts.write) return { candidates, created: 0 };

  let created = 0;
  const idNum = (ref: string) => ref.replace(/^fep_player_/, '');
  let failed = 0;
  for (const c of candidates) {
    try {
    await withTransaction(async (client) => {
      for (const portal of c.split) {
        // Nombre de la persona en SU portal: el más repetido de sus alineaciones.
        const nombre = await client.query<{ player_name: string }>(
          `SELECT ml.player_name FROM match_lineups ml
            WHERE ml.player_id = $1 AND ${matchInPortal('ml', '$2')}
            GROUP BY ml.player_name ORDER BY count(*) DESC, ml.player_name LIMIT 1`,
          [c.playerId, portal],
        );
        const { firstName, lastName } = nombre.rows[0]
          ? splitName(nombre.rows[0].player_name)
          : splitName(c.name);
        const newRef = `${portal}_player_${idNum(c.sourceRef)}`;

        // ¿La persona de ese portal ya existe? (pasada anterior cortada, o una
        // ficha posterior que la creó). Se reutiliza: crearla otra vez chocaba
        // con el slug `{slug}-{portal}` y abortaba TODA la separación (prod 23/10).
        const existente = await client.query<{ id: string }>(
          `SELECT player_id AS id FROM player_source_refs WHERE source_ref = $1
           UNION ALL SELECT id FROM players WHERE source_ref = $1 LIMIT 1`,
          [newRef],
        );
        let newId = existente.rows[0]?.id;
        if (!newId) {
          // Slug `{slug}-{portal}`; si lo tiene OTRA persona, se añade el id de fuente.
          const base = (await client.query<{ slug: string }>(`SELECT slug FROM players WHERE id = $1`, [c.playerId])).rows[0]!.slug;
          let slug = `${base}-${portal}`;
          const ocupado = await client.query(`SELECT 1 FROM players p0 JOIN players p ON p.sport_id = p0.sport_id
                                                WHERE p0.id = $1 AND p.slug = $2`, [c.playerId, slug]);
          if ((ocupado.rowCount ?? 0) > 0) slug = `${slug}-${idNum(c.sourceRef)}`;
          // La foto NO se copia: la de la fila original es del otro portal.
          const ins = await client.query<{ id: string }>(
            `INSERT INTO players (sport_id, first_name, last_name, slug, source_ref, scraped_at)
             SELECT p.sport_id, $2, $3, $4, $5, NOW() FROM players p WHERE p.id = $1
             RETURNING id`,
            [c.playerId, firstName, lastName, slug, newRef],
          );
          newId = ins.rows[0]!.id;
          created++;
        }
        // B1: la ref del otro portal es de la persona nueva (084).
        await client.query(
          `INSERT INTO player_source_refs (player_id, source_ref, created_by) VALUES ($1, $2, 'split-merged-players')
           ON CONFLICT (source_ref) DO UPDATE SET player_id = EXCLUDED.player_id`,
          [newId, newRef],
        );

        // Si la persona ya existía puede tener ya esa plantilla: se quita la
        // fila duplicada del original en vez de chocar con el UNIQUE.
        await client.query(
          `DELETE FROM team_players tp
            WHERE tp.player_id = $1
              AND EXISTS (SELECT 1 FROM team_players t2
                           WHERE t2.player_id = $2 AND t2.season_id = tp.season_id AND t2.team_id = tp.team_id)`,
          [c.playerId, newId],
        );
        await client.query(
          `UPDATE team_players tp SET player_id = $2, updated_at = NOW()
            WHERE tp.player_id = $1
              AND EXISTS (SELECT 1 FROM seasons ss JOIN competitions cc ON cc.id = ss.competition_id
                           WHERE ss.id = tp.season_id
                             AND competition_portal_key(cc.organizer, cc.source_ref) = $3)`,
          [c.playerId, newId, portal],
        );
        await client.query(
          `UPDATE match_lineups ml SET player_id = $2 WHERE ml.player_id = $1 AND ${matchInPortal('ml', '$3')}`,
          [c.playerId, newId, portal],
        );
        await client.query(
          `UPDATE match_events e SET player_id = $2 WHERE e.player_id = $1 AND ${matchInPortal('e', '$3')}`,
          [c.playerId, newId, portal],
        );
      }
    });
    } catch (err) {
      // Un jugador que falla no aborta al resto (antes, el primero tumbaba los 15).
      failed++;
      log.error({ err, playerId: c.playerId, sourceRef: c.sourceRef, name: c.name }, 'No se pudo separar este jugador — sigue con el siguiente');
    }
  }
  log.info({ candidates: candidates.length, created, failed }, 'Separación terminada');
  return { candidates, created };
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const r = await splitMergedPlayers({ write });
  console.log(`${r.candidates.length} jugadores fusionados${write ? `, ${r.created} personas creadas` : ' (dry-run: repite con --write)'}`);
}

const esEjecucionDirecta = process.argv[1] === fileURLToPath(import.meta.url);
if (esEjecucionDirecta) {
  main()
    .catch((err) => {
      log.error({ err }, 'Error fatal separando jugadores');
      process.exit(1);
    })
    .finally(() => closeDb());
}
