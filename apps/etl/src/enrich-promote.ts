/**
 * ENRICH-PROMOTE (A5 · Fase 3). La ÚNICA pieza que escribe sobre filas NATIVAS
 * de prod, así que va con toda la red:
 *
 *   1. Reconecta a staging (origen) y prod (destino).
 *   2. RE-VALIDA las guardas duras del lote en staging (todos movidos de
 *      'Histórico', con fecha, sin colisiones en destino). Si algo falla, aborta
 *      SIN escribir.
 *   3. En UNA transacción en prod: crea las temporadas destino que falten (mismo
 *      UUID que staging), y por cada partido del lote —casado por source_ref y
 *      SOLO si en prod sigue en 'Histórico'— guarda el valor anterior en
 *      enrich_changes y aplica el UPDATE. LISTA BLANCA: season_id, scheduled_at
 *      y —solo si la clasificación reconcilia, prueba de que el re-scrape es
 *      fuente de verdad— home_score/away_score. Nada más.
 *   4. Marca el lote 'promoted'.
 *
 * Idempotente (re-ejecutar no vuelve a mover: el partido ya no está en
 * 'Histórico'). Reversible: `--revert` restaura season_id/scheduled_at anteriores
 * desde enrich_changes.
 *
 * Por defecto DRY-RUN. Escribe solo con --commit.
 *
 * Uso (desde apps/etl, por el túnel, con STAGING_URL y PROD_URL):
 *   npx tsx src/enrich-promote.ts --batch <label>            # dry-run
 *   npx tsx src/enrich-promote.ts --batch <label> --commit   # escribe en prod
 *   npx tsx src/enrich-promote.ts --batch <label> --revert   # deshace en prod
 */
import pg from 'pg';
import type { Pool as PgPool, PoolClient } from 'pg';
const { Pool } = pg;

// Copia genérica de filas src→dst preservando columnas (incl. UUID). Para crear
// en prod las temporadas/competiciones destino que aún no existan.
async function copyRows(src: PgPool, dst: PoolClient, table: string, selectSql: string,
                        params: unknown[], excludeCols: string[] = []) {
  const rows = (await src.query(selectSql, params)).rows;
  let inserted = 0;
  for (const row of rows) {
    // Excluir columnas GENERATED (p. ej. standings.goal_diff): Postgres las calcula
    // y rechaza un INSERT con valor. copyRows es genérico y no las distingue.
    const cols = Object.keys(row).filter((c) => !excludeCols.includes(c));
    const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
    const colList = cols.map((c) => `"${c}"`).join(', ');
    const r = await dst.query(
      `INSERT INTO ${table} (${colList}) VALUES (${ph}) ON CONFLICT DO NOTHING`,
      cols.map((c) => row[c]));
    inserted += r.rowCount ?? 0;
  }
  return { read: rows.length, inserted };
}

async function main() {
  const args = process.argv.slice(2);
  const bi = args.indexOf('--batch');
  const batchLabel = bi >= 0 ? args[bi + 1] : undefined;
  const commit = args.includes('--commit');
  const revert = args.includes('--revert');
  if (!batchLabel) throw new Error('Falta --batch <label>');

  const stagingUrl = process.env['STAGING_URL'];
  const prodUrl = process.env['PROD_URL'];
  if (!stagingUrl || !prodUrl) throw new Error('Define STAGING_URL y PROD_URL en el entorno');

  const staging = new Pool({ connectionString: stagingUrl });
  const prod = new Pool({ connectionString: prodUrl });

  try {
    // El lote se resuelve en staging (donde nació); en revert, en prod (donde se
    // registró la promoción). Mismo label, mismo UUID (staging se sembró de prod).
    const batchRow = (await (revert ? prod : staging).query<{ id: string }>(
      `SELECT id FROM import_batches WHERE label = $1 AND kind = 'enrich'`, [batchLabel])).rows[0];
    if (!batchRow) throw new Error(`No existe lote enrich con label='${batchLabel}'`);
    const batchId = batchRow.id;
    const bp = [batchId];

    // ── REVERT ─────────────────────────────────────────────────────────────────
    if (revert) {
      const changes = (await prod.query<{ match_id: string; old_season_id: string | null; old_scheduled_at: Date | null; old_home_score: number | null; old_away_score: number | null }>(
        `SELECT match_id, old_season_id, old_scheduled_at, old_home_score, old_away_score
           FROM enrich_changes WHERE batch_id = $1`, bp)).rows;
      if (!commit) {
        process.stdout.write(`\n─── DRY-RUN revert enrich '${batchLabel}' ───\n  ${changes.length} partidos volverían a su season_id/scheduled_at anterior.\n  Repite con --commit --revert para deshacer.\n\n`);
        return;
      }
      const client = await prod.connect();
      try {
        await client.query('BEGIN');
        let n = 0;
        for (const ch of changes) {
          const r = await client.query(
            `UPDATE matches SET season_id = $2, scheduled_at = $3, home_score = $4, away_score = $5, updated_at = NOW()
              WHERE id = $1`,
            [ch.match_id, ch.old_season_id, ch.old_scheduled_at, ch.old_home_score, ch.old_away_score]);
          n += r.rowCount ?? 0;
        }
        await client.query(`UPDATE import_batches SET status = 'reverted', finished_at = NOW() WHERE id = $1`, bp);
        await client.query('COMMIT');
        process.stdout.write(`\n─── Revert enrich '${batchLabel}' COMPLETADO ───\n  ${n} partidos restaurados. Lote marcado 'reverted'.\n\n`);
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
      return;
    }

    // ── Guardas duras (re-validación antes de escribir) ────────────────────────
    const guard = async (desc: string, sql: string) => {
      const n = Number((await staging.query<{ n: string }>(sql, bp)).rows[0]?.n ?? 0);
      if (n > 0) throw new Error(`ABORTADO — guarda fallida (${n}): ${desc}. Corre validate-enrich para el detalle.`);
    };
    await guard("partidos del lote aún en 'Histórico' en staging",
      `SELECT count(*) n FROM matches m JOIN seasons s ON s.id = m.season_id
        WHERE m.import_batch_id = $1 AND s.slug = 'historico'`);
    await guard('partidos del lote sin fecha',
      `SELECT count(*) n FROM matches WHERE import_batch_id = $1 AND scheduled_at IS NULL`);
    await guard('colisiones de fecha en la temporada destino',
      `SELECT count(*) n FROM matches b WHERE b.import_batch_id = $1 AND b.scheduled_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM matches o WHERE o.id <> b.id AND o.season_id = b.season_id
                       AND o.home_team_id = b.home_team_id AND o.away_team_id = b.away_team_id
                       AND o.scheduled_at::date = b.scheduled_at::date)`);
    await guard('la clasificación no reconcilia con los partidos (re-scrape no fiable)',
      `SELECT count(*) n FROM (
         SELECT st.goals_for, st.goals_against, COALESCE(c.gf,0) gf, COALESCE(c.ga,0) ga
           FROM standings st
           LEFT JOIN (
             SELECT season_id, team_id, SUM(gf) gf, SUM(ga) ga FROM (
               SELECT season_id, home_team_id AS team_id, home_score AS gf, away_score AS ga FROM matches
                 WHERE status='finished' AND home_score IS NOT NULL
               UNION ALL
               SELECT season_id, away_team_id, away_score, home_score FROM matches
                 WHERE status='finished' AND away_score IS NOT NULL
             ) t GROUP BY season_id, team_id
           ) c ON c.season_id = st.season_id AND c.team_id = st.team_id
          WHERE st.season_id IN (SELECT DISTINCT season_id FROM matches WHERE import_batch_id = $1)
       ) r WHERE r.goals_for <> r.gf OR r.goals_against <> r.ga`);

    // Conjunto a enriquecer: cada partido del lote con su temporada real y su fecha.
    const targets = (await staging.query<{ source_ref: string; season_id: string; scheduled_at: Date; home_score: number | null; away_score: number | null }>(
      `SELECT source_ref, season_id, scheduled_at, home_score, away_score FROM matches
        WHERE import_batch_id = $1 AND source_ref IS NOT NULL AND scheduled_at IS NOT NULL`, bp)).rows;

    // ── Dry-run: cuánto se movería realmente (solo lo que en prod sigue en 'Histórico') ──
    if (!commit) {
      const refs = targets.map((t) => t.source_ref);
      const enProdHist = refs.length ? Number((await prod.query<{ n: string }>(
        `SELECT count(*) n FROM matches m JOIN seasons s ON s.id = m.season_id
          WHERE m.source_ref = ANY($1) AND s.slug = 'historico'`, [refs])).rows[0]?.n ?? 0) : 0;
      process.stdout.write(`\n─── DRY-RUN enrich '${batchLabel}' (staging → prod) ───\n`);
      process.stdout.write(`  ${String(targets.length).padStart(6)}  partidos del lote con fecha en staging\n`);
      process.stdout.write(`  ${String(enProdHist).padStart(6)}  se enriquecerían en prod (siguen en 'Histórico'; el resto ya movidos o inexistentes)\n`);
      process.stdout.write(`\n  Guardas: OK. Nada escrito. Repite con --commit para enriquecer.\n\n`);
      return;
    }

    // ── Promoción real: una transacción en prod ────────────────────────────────
    const client = await prod.connect();
    try {
      await client.query('BEGIN');
      // 1. Crear en prod, si faltan, la competición y la temporada destino (mismo UUID).
      await copyRows(staging, client, 'competitions',
        `SELECT DISTINCT c.* FROM competitions c JOIN seasons s ON s.competition_id = c.id
           JOIN matches m ON m.season_id = s.id WHERE m.import_batch_id = $1`, bp);
      await copyRows(staging, client, 'seasons',
        `SELECT DISTINCT s.* FROM seasons s JOIN matches m ON m.season_id = s.id
           WHERE m.import_batch_id = $1`, bp);
      // 2. Copiar el propio lote a prod para que enrich_changes.batch_id resuelva.
      await copyRows(staging, client, 'import_batches',
        `SELECT * FROM import_batches WHERE id = $1`, bp);
      // 2b. Extras de la(s) temporada(s) del lote: clasificación, jugadores, actas
      // y alineaciones (add-only, ON CONFLICT DO NOTHING). Los partidos ya existen
      // en prod (se mueven en el paso 3); esto completa la foto de la temporada.
      await copyRows(staging, client, 'players',
        `SELECT DISTINCT p.* FROM players p
           JOIN match_events e ON e.player_id = p.id
           JOIN matches m ON e.match_id = m.id WHERE m.import_batch_id = $1`, bp);
      await copyRows(staging, client, 'standings',
        `SELECT s.* FROM standings s
          WHERE s.season_id IN (SELECT DISTINCT season_id FROM matches WHERE import_batch_id = $1)`,
        bp, ['goal_diff']);
      await copyRows(staging, client, 'match_events',
        `SELECT e.* FROM match_events e JOIN matches m ON e.match_id = m.id
          WHERE m.import_batch_id = $1`, bp);
      await copyRows(staging, client, 'match_lineups',
        `SELECT l.* FROM match_lineups l JOIN matches m ON l.match_id = m.id
          WHERE m.import_batch_id = $1`, bp);

      // 3. Por partido: capturar valor anterior y aplicar el UPDATE (lista blanca).
      let updated = 0, skipped = 0;
      for (const t of targets) {
        const cur = (await client.query<{ id: string; season_id: string; scheduled_at: Date | null; home_score: number | null; away_score: number | null }>(
          `SELECT id, season_id, scheduled_at, home_score, away_score FROM matches
            WHERE source_ref = $1 AND season_id IN (SELECT id FROM seasons WHERE slug = 'historico')`,
          [t.source_ref])).rows[0];
        if (!cur) { skipped++; continue; } // ya movido / inexistente en prod → nada que hacer
        await client.query(
          `INSERT INTO enrich_changes (batch_id, match_id, old_season_id, old_scheduled_at, old_home_score, old_away_score)
                VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (batch_id, match_id) DO NOTHING`,
          [batchId, cur.id, cur.season_id, cur.scheduled_at, cur.home_score, cur.away_score]);
        // LISTA BLANCA: season_id + scheduled_at + marcador (el re-scrape reconcilió). Nada más.
        await client.query(
          `UPDATE matches SET season_id = $2, scheduled_at = $3, home_score = $4, away_score = $5, updated_at = NOW()
            WHERE id = $1`,
          [cur.id, t.season_id, t.scheduled_at, t.home_score, t.away_score]);
        updated++;
      }

      await client.query(
        `UPDATE import_batches SET status = 'promoted', finished_at = NOW(),
                stats = $2::jsonb WHERE id = $1`,
        [batchId, JSON.stringify({ enriquecidos: updated, saltados: skipped, candidatos: targets.length })]);
      await client.query('COMMIT');

      process.stdout.write(`\n─── Enrich '${batchLabel}' COMPLETADO (staging → prod) ───\n`);
      process.stdout.write(`  ${updated} partidos enriquecidos (fecha + temporada), ${skipped} saltados.\n`);
      process.stdout.write(`  Revertir: npx tsx src/enrich-promote.ts --batch '${batchLabel}' --revert --commit\n\n`);
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  } finally {
    await staging.end();
    await prod.end();
  }
}

main().catch((err) => { console.error('Error en enrich-promote:', err instanceof Error ? err.message : err); process.exitCode = 1; });
