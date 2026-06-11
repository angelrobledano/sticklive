/**
 * Diagnóstico: filas de standings de la temporada DEFAULT (liga regular).
 * Uso: npx tsx --env-file=.env apps/etl/src/debug-standings.ts
 */
import { db, closeDb } from '@sports/db';

void (async () => {
  const seasonId = process.env['DEFAULT_SEASON_ID'];
  const { rows } = await db.query(
    `SELECT s.id, t.short_name AS equipo, s.group_name, s.position, s.points,
            to_char(s.scraped_at, 'DD/MM HH24:MI') AS scraped,
            to_char(s.created_at, 'DD/MM HH24:MI') AS created
     FROM standings s JOIN teams t ON t.id = s.team_id
     WHERE s.season_id = $1
     ORDER BY s.position NULLS LAST, t.short_name, s.created_at`,
    [seasonId]
  );
  console.table(rows.map(r => ({ ...r, id: String(r.id).slice(0, 8), group: JSON.stringify(r.group_name) })));
  console.log(`Total: ${rows.length} filas`);
  const mig = await db.query(`SELECT filename FROM _migrations ORDER BY id`);
  console.log('Migraciones aplicadas:', mig.rows.map(r => r.filename).join(', '));
  await closeDb();
})();
