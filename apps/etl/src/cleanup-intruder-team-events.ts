/**
 * Reparación de datos: eventos de match_events atribuidos a un equipo que NO
 * juega el partido (#325).
 *
 * En 3 fichas de filiales, los eventos del acta quedaron apuntando al PRIMER
 * equipo del club (p. ej. "HOCKEY CLUB LICEO" en un partido de LICEO B). La FK
 * no lo detecta porque el equipo intruso existe; el timeline muestra goles
 * falsos y los goles por equipo no cuadran con el marcador.
 *
 * La guarda preventiva vive ahora en replaceMatchEvents (todo evento con
 * team_id fuera del cruce home/away se guarda sin equipo). Este script limpia
 * los que ya estaban: team_id := NULL (mejor "sin equipo" que equipo
 * equivocado); el próximo barrido de fichas los re-atribuye con el isHome del
 * acta si procede.
 *
 * Dry-run por defecto: lista lo que tocaría. Con --apply ejecuta el UPDATE.
 *
 * Uso:
 *   npx tsx --env-file=.env apps/etl/src/cleanup-intruder-team-events.ts
 *   npx tsx --env-file=.env apps/etl/src/cleanup-intruder-team-events.ts --apply
 */
import { db, closeDb } from '@sports/db';

const apply = process.argv.includes('--apply');

void (async () => {
  const { rows } = await db.query<{
    match_id: string; event_type: string; source_ref: string | null; team: string | null;
    home: string | null; away: string | null;
  }>(
    `SELECT e.match_id, e.event_type, e.source_ref,
            t.name AS team, ht.name AS home, at.name AS away
       FROM match_events e
       JOIN matches m ON m.id = e.match_id
       LEFT JOIN teams t  ON t.id  = e.team_id
       LEFT JOIN teams ht ON ht.id = m.home_team_id
       LEFT JOIN teams at ON at.id = m.away_team_id
      WHERE e.team_id IS NOT NULL
        AND e.team_id <> m.home_team_id
        AND e.team_id <> m.away_team_id`
  );

  console.log(`🔎 Eventos con equipo fuera del cruce (home/away): ${rows.length}`);
  for (const r of rows) {
    console.log(`  - ${r.source_ref ?? '(sin ref)'} ${r.event_type} | intruso="${r.team ?? '?'}" | cruce="${r.home ?? '?'}" vs "${r.away ?? '?'}"`);
  }

  if (!apply) {
    console.log('Dry-run: no se ha modificado nada. Revisa el listado y lanza con --apply.');
  } else {
    const res = await db.query(
      `UPDATE match_events e
          SET team_id = NULL
         FROM matches m
        WHERE e.match_id = m.id
          AND e.team_id IS NOT NULL
          AND e.team_id <> m.home_team_id
          AND e.team_id <> m.away_team_id`
    );
    console.log(`🧹 Eventos guardados sin equipo: ${res.rowCount ?? 0}`);
  }
  await closeDb();
})();
