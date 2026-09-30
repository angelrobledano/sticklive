/**
 * Backfill: vincula filas de match_lineups sin player_id con la tabla
 * players por slug canónico del nombre. Útil tras crear jugadores nuevos
 * (las fichas solo vinculan en el momento del scrape).
 *
 * Uso: npx tsx --env-file=.env apps/etl/src/link-lineup-players.ts
 */
import { db, closeDb } from '@sports/db';

function slugify(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

void (async () => {
  // PASO 1 (#219): vinculación EXACTA por ref del acta — player_source_ref
  // (migración 061) contra players.source_ref. Sin heurística de nombre: la
  // ref es el id federativo del acta. Este paso cura las alineaciones
  // scrapeadas ANTES de que el scraper guardara la ref.
  const porRef = await db.query(
    `UPDATE match_lineups ml
        SET player_id = p.id
       FROM players p
      WHERE ml.player_id IS NULL
        AND ml.player_source_ref IS NOT NULL
        AND p.source_ref = ml.player_source_ref`
  );
  console.log(`🎯 ${porRef.rowCount ?? 0} vinculadas por ref exacta del acta (#219)`);

  // PASO 2: fallback por slug canónico del nombre (histórico sin ref).
  const { rows: pending } = await db.query<{ id: string; player_name: string }>(
    `SELECT id, player_name FROM match_lineups WHERE player_id IS NULL`
  );
  console.log(`${pending.length} filas de alineación sin jugador vinculado (tras la fase por ref)`);

  const { rows: players } = await db.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM players`
  );
  const bySlug = new Map(players.map((p) => [p.slug, p.id]));

  let linked = 0;
  for (const row of pending) {
    const playerId = bySlug.get(slugify(row.player_name));
    if (!playerId) continue;
    await db.query(`UPDATE match_lineups SET player_id = $2 WHERE id = $1`, [row.id, playerId]);
    linked++;
  }
  console.log(`✅ ${linked} vinculadas por slug · ${pending.length - linked} sin jugador en DB (aún sin eventos en ninguna ficha)`);

  // Backfill de dorsales en team_players desde el acta más reciente de cada jugador
  const dorsales = await db.query(
    `UPDATE team_players tp
     SET jersey_number = sub.jersey_number, updated_at = NOW()
     FROM (
       SELECT DISTINCT ON (ml.player_id, m.season_id)
              ml.player_id, m.season_id, ml.jersey_number,
              CASE WHEN ml.is_home THEN m.home_team_id ELSE m.away_team_id END AS team_id
       FROM match_lineups ml
       JOIN matches m ON m.id = ml.match_id
       WHERE ml.player_id IS NOT NULL AND ml.jersey_number IS NOT NULL
       ORDER BY ml.player_id, m.season_id, m.scheduled_at DESC
     ) sub
     WHERE tp.player_id = sub.player_id
       AND tp.season_id = sub.season_id
       AND tp.team_id   = sub.team_id
     RETURNING tp.id`
  );
  console.log(`🔢 ${dorsales.rowCount ?? 0} dorsales actualizados en team_players`);
  await closeDb();
})();
