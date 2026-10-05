/**
 * INFORME de limpieza estructural de temporadas (#234) — SOLO LECTURA.
 *
 * La auditoría de integridad (2026-09-27) encontró residuos del import que
 * confunden: temporadas 'Histórico' duplicadas/vacías, temporadas reales
 * duplicadas y semillas sin partidos. Antes de fusionar/borrar nada (migración
 * destructiva, con backup y trazada) este script LISTA el alcance real, para
 * decidir y dimensionar. No escribe nada.
 *
 * Uso: node dist/apps/etl/src/season-cleanup-report.js
 */
import { db, closeDb } from '@sports/db';

async function count(sql: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(sql);
  return Number(rows[0]?.n ?? 0);
}

void (async () => {
  const historicoTotal = await count(`SELECT count(*)::text n FROM seasons WHERE slug LIKE 'historico%'`);
  const historicoEmpty = await count(`
    SELECT count(*)::text n FROM seasons s WHERE s.slug LIKE 'historico%'
      AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.season_id = s.id)`);
  const historicoDupComps = await count(`
    SELECT count(*)::text n FROM (
      SELECT competition_id FROM seasons WHERE slug LIKE 'historico%'
       GROUP BY competition_id HAVING count(*) > 1) x`);
  const realDupGroups = await count(`
    SELECT count(*)::text n FROM (
      SELECT competition_id, name FROM seasons WHERE slug NOT LIKE 'historico%'
       GROUP BY competition_id, name HAVING count(*) > 1) x`);
  const emptySeasons = await count(`
    SELECT count(*)::text n FROM seasons s
     WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.season_id = s.id)`);
  const seasonTeamsNoMatches = await count(`
    SELECT count(*)::text n FROM season_teams st
     WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.season_id = st.season_id)`);
  const teamPlayersNoSeasonTeam = await count(`
    SELECT count(*)::text n FROM team_players tp
     WHERE NOT EXISTS (SELECT 1 FROM season_teams st
                        WHERE st.season_id = tp.season_id AND st.team_id = tp.team_id)`);

  // Muestras para revisar a mano (las que decide la migración).
  const dupSample = (await db.query<{ comp: string; n: string; slugs: string }>(`
    SELECT c.name AS comp, count(*)::text AS n, string_agg(s.slug, ', ' ORDER BY s.slug) AS slugs
      FROM seasons s JOIN competitions c ON c.id = s.competition_id
     WHERE s.slug LIKE 'historico%'
     GROUP BY c.name HAVING count(*) > 1
     ORDER BY count(*) DESC LIMIT 10`)).rows;

  process.stdout.write(`\n─── Informe de limpieza de temporadas (#234) — solo lectura ───\n\n`);
  process.stdout.write(`  ${String(historicoTotal).padStart(6)}  temporadas 'Histórico' (totales)\n`);
  process.stdout.write(`  ${String(historicoEmpty).padStart(6)}  de ellas VACÍAS (0 partidos)\n`);
  process.stdout.write(`  ${String(historicoDupComps).padStart(6)}  competiciones con 'Histórico' DUPLICADA\n`);
  process.stdout.write(`  ${String(realDupGroups).padStart(6)}  pares (competición, nombre) de temporada real duplicados\n`);
  process.stdout.write(`  ${String(emptySeasons).padStart(6)}  temporadas sin ningún partido (semillas)\n`);
  process.stdout.write(`  ${String(seasonTeamsNoMatches).padStart(6)}  filas season_teams en temporadas sin partidos\n`);
  process.stdout.write(`  ${String(teamPlayersNoSeasonTeam).padStart(6)}  team_players sin su (temporada, equipo) en season_teams\n`);

  if (dupSample.length > 0) {
    process.stdout.write(`\n  Competiciones con 'Histórico' duplicada (muestra):\n`);
    for (const r of dupSample) process.stdout.write(`    ×${r.n.padStart(2)}  ${r.comp}  [${r.slugs}]\n`);
  }
  process.stdout.write(`\n  Nada escrito. La limpieza (fusionar/borrar) es una migración aparte, con backup y trazada.\n\n`);
  await closeDb();
})();
