/**
 * Backfill de `season_teams` derivado de las ALINEACIONES cargadas (#220).
 *
 * Las temporadas 2022/23–2023/24 del histórico llegaron con actas completas
 * (match_lineups con player_id) pero `season_teams` vacío o parcial: las fichas
 * de equipo quedaban sin plantilla y los checks de integridad (#231) contaban
 * equipos "fuera de temporada".
 *
 * Deriva (season, equipo, jugador) de las alineaciones — la MISMA regla que
 * aplica el scraper desde #216 en cada ficha nueva — para las temporadas que
 * se indiquen o, si no se pasa ninguna, para TODAS las temporadas con
 * alineaciones vinculadas (idempotente: ON CONFLICT DO NOTHING).
 *
 * Dry-run por defecto: lista lo que insertaría por temporada. --apply ejecuta.
 *
 * Uso:
 *   npx tsx --env-file=.env apps/etl/src/backfill-season-teams-from-lineups.ts
 *   npx tsx --env-file=.env apps/etl/src/backfill-season-teams-from-lineups.ts --apply
 *   npx tsx --env-file=.env apps/etl/src/backfill-season-teams-from-lineups.ts --apply --season=62ed6d2f-...,25c4ffd3-...
 */
import { db, closeDb } from '@sports/db';

const apply = process.argv.includes('--apply');
const seasonArg = process.argv.find((a) => a.startsWith('--season='));
const seasonFilter = seasonArg ? seasonArg.replace('--season=', '').split(',').map((s) => s.trim()).filter(Boolean) : null;

void (async () => {
  // Cobertura actual por temporada con alineaciones vinculadas
  const { rows: cobertura } = await db.query<{
    season_id: string; temporada: string; comp: string;
    con_link: string; equipos_en_lineups: string; equipos_en_season_teams: string;
  }>(
    `SELECT s.id AS season_id, s.name AS temporada, c.name AS comp,
            COUNT(DISTINCT ml.player_id) FILTER (WHERE ml.player_id IS NOT NULL) AS con_link,
            COUNT(DISTINCT CASE WHEN ml.player_id IS NOT NULL THEN CASE WHEN ml.is_home THEN m.home_team_id ELSE m.away_team_id END END) AS equipos_en_lineups,
            (SELECT count(DISTINCT st.team_id) FROM season_teams st WHERE st.season_id = s.id) AS equipos_en_season_teams
       FROM match_lineups ml
       JOIN matches m ON m.id = ml.match_id
       JOIN seasons s ON s.id = m.season_id
       JOIN competitions c ON c.id = s.competition_id
      WHERE ml.player_id IS NOT NULL
      GROUP BY s.id, s.name, c.id, c.name
     HAVING COUNT(DISTINCT ml.player_id) > 0
      ORDER BY s.start_date DESC`
  );

  const objetivo = cobertura.filter((r) => !seasonFilter || seasonFilter.includes(r.season_id) || (seasonFilter && seasonFilter.some((f) => r.season_id.startsWith(f))));
  console.log(`Temporadas con alineaciones vinculadas: ${cobertura.length}; objetivo: ${objetivo.length}`);

  let altasTotales = 0;
  for (const r of objetivo) {
    const deficit = Number(r.equipos_en_lineups) - Number(r.equipos_en_season_teams);
    if (deficit <= 0 && !seasonFilter) continue; // ya cubierta (solo mostramos)

    if (!apply) {
      console.log(`  [dry] ${r.temporada} · ${r.comp}: equipos en alineaciones=${r.equipos_en_lineups}, en season_teams=${r.equipos_en_season_teams}, jugadores con link=${r.con_link}`);
      continue;
    }
    const res = await db.query(
      `INSERT INTO season_teams (season_id, team_id)
       SELECT DISTINCT m.season_id,
              CASE WHEN ml.is_home THEN m.home_team_id ELSE m.away_team_id END
         FROM match_lineups ml
         JOIN matches m ON m.id = ml.match_id
        WHERE m.season_id = $1 AND ml.player_id IS NOT NULL
       ON CONFLICT (season_id, team_id) DO NOTHING`,
      [r.season_id]
    );
    altasTotales += res.rowCount ?? 0;
    console.log(`  ✅ ${r.temporada} · ${r.comp}: +${res.rowCount ?? 0} season_teams`);
  }

  if (!apply) {
    console.log('\nDry-run: no se ha escrito nada. Lanza con --apply para ejecutar.');
  } else {
    console.log(`\n🧹 season_teams derivadas: ${altasTotales}`);
  }

  // Los equipos en season_teams sin plantilla real quedan; el criterio de
  // aceptación de #220 es que las fichas de equipo muestren plantilla.
  await closeDb();
})();
