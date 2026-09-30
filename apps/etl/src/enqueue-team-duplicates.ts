/**
 * Higiene de equipos (#200): pasada DETERMINISTA sobre los equipos existentes
 * que alimenta la cola HITL — nada se fusiona ni borra automáticamente.
 *
 * Dos familias de candidatos:
 *   1. FRAGMENTACIÓN: pares de equipos del mismo deporte con nombre muy
 *      similar (pg_trgm ≥ 0.75) — el clásico "LAS ROZAS"/"CLUB PATIN LAS
 *      ROZAS" o un club entrado dos veces con slug distinto. Un candidato por
 *      PAR (no por nombre): el panel ve los dos equipos y decide.
 *   2. FANTASMAS: equipos sin ningún partido y sin pertenencia a temporada —
 *      restos de imports. Sólo se LISTAN (borrar es destructivo): el panel/
 *      HITL decide.
 *
 * La cola es reversible por diseño (resolved/rejected por un humano; el
 * re-ejecutar sólo incrementa `occurrences` de los pendientes).
 *
 * Dry-run por defecto: lista lo que encolaría. --apply encola.
 *
 * Uso:
 *   npx tsx --env-file=.env apps/etl/src/enqueue-team-duplicates.ts
 *   npx tsx --env-file=.env apps/etl/src/enqueue-team-duplicates.ts --apply
 */
import { db, closeDb } from '@sports/db';

const apply = process.argv.includes('--apply');
const UMBRAL = Number(process.env['TEAM_DUPE_SIMILARITY'] ?? 0.75);

void (async () => {
  // ── 1. Pares sospechosos ──────────────────────────────────────────────────
  const { rows: pares } = await db.query<{
    a_id: string; a_name: string; a_source: string | null;
    b_id: string; b_name: string; b_source: string | null;
    sport: string; score: number;
  }>(
    `SELECT t1.id AS a_id, t1.name AS a_name, t1.source_id AS a_source,
            t2.id AS b_id, t2.name AS b_name, t2.source_id AS b_source,
            sp.slug AS sport, similarity(lower(t1.name), lower(t2.name))::float AS score
       FROM teams t1
       JOIN teams t2   ON t1.sport_id = t2.sport_id AND t1.id < t2.id
       JOIN sports sp  ON sp.id = t1.sport_id
      WHERE similarity(lower(t1.name), lower(t2.name)) >= $1
      ORDER BY score DESC`,
    [UMBRAL]
  );
  console.log(`🔎 Pares de equipos con similitud ≥ ${UMBRAL}: ${pares.length}`);

  // ¿Ya hay entrada en cola para alguno de los dos nombres (cualquier estado)?
  const { rows: enCola } = await db.query<{ normalized: string }>(
    `SELECT DISTINCT normalized FROM resolution_queue`
  );
  const yaEnCola = new Set(enCola.map((r) => r.normalized));

  const { rows: fuentes } = await db.query<{ id: string; scraper_key: string }>(
    `SELECT id, scraper_key FROM data_sources`
  );
  const fepId = fuentes.find((f) => f.scraper_key === 'fep_hockey')?.id;

  let encolados = 0;
  for (const p of pares) {
    // Etiqueta del par en orden determinista (a < b por id).
    const [primero, segundo] = [p.a_name, p.b_name].sort();
    const parLabel = `${primero} ⇄ ${segundo}`;
    // normalized = nombre normalizado del par; fuente = FEP (la única de la
    // que hoy vienen equipos) para encajar en UNIQUE(normalized, source_id).
    if (!fepId) { console.log('Sin fuente fep_hockey — no se puede encolar'); break; }

    if (yaEnCola.has(parLabel.toLowerCase())) { continue; }

    console.log(`  [${p.score.toFixed(2)}] ${p.a_name} ⇄ ${p.b_name} (${p.sport})`);
    if (!apply) continue;

    await db.query(
      `INSERT INTO resolution_queue (raw_text, normalized, source_id, source_ref, context, candidates)
            VALUES ($1, $2, $3, NULL, $4::jsonb, $5::jsonb)
       ON CONFLICT (normalized, source_id) DO UPDATE
          SET occurrences = resolution_queue.occurrences + 1,
              candidates  = EXCLUDED.candidates,
              updated_at  = NOW()
        WHERE resolution_queue.status = 'pending'`,
      [
        parLabel,
        parLabel.toLowerCase(),
        fepId,
        JSON.stringify({
          kind: 'team-duplicate',
          sport: p.sport,
          score: p.score,
          teamA: { id: p.a_id, name: p.a_name },
          teamB: { id: p.b_id, name: p.b_name },
        }),
        JSON.stringify([
          { teamId: p.a_id, name: p.a_name, score: p.score },
          { teamId: p.b_id, name: p.b_name, score: p.score },
        ]),
      ]
    );
    encolados++;
  }
  console.log(apply ? `✅ ${encolados} pares encolados (o actualizados) en resolution_queue` : 'Dry-run: nada encolado. Lanza con --apply.');

  // ── 2. Fantasmas (sólo listado: borrar es destructivo) ────────────────────
  const { rows: fantasmas } = await db.query<{ name: string; slug: string; source_ref: string | null }>(
    `SELECT t.name, t.slug, t.source_ref
       FROM teams t
      WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.home_team_id = t.id OR m.away_team_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM season_teams st WHERE st.team_id = t.id)
      ORDER BY t.name`
  );
  console.log(`👻 Equipos fantasma (0 partidos, 0 season_teams): ${fantasmas.length} — listado para decisión HITL, no se borran aquí:`);
  for (const f of fantasmas) console.log(`   - ${f.name} (${f.slug}${f.source_ref ? `, ref ${f.source_ref}` : ''})`);

  await closeDb();
})();
