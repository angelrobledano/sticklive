/**
 * PROMOCIÓN STAGING → PROD (A4 · Fase 3).
 *
 * Copia a producción SOLO el lote (import_batch) ya validado en staging. Es la
 * ÚNICA pieza del ciclo que escribe en prod, así que va con toda la red:
 *
 *   1. Reconecta a las DOS bases (staging=origen, prod=destino). Mismo Postgres,
 *      mismo túnel; distinto nombre de BD.
 *   2. RE-VALIDA las guardas duras del lote en staging (integridad + el cruce de
 *      duplicados por día/source_ref). Si algo falla, aborta SIN escribir.
 *   3. Copia en ORDEN DE FK dentro de UNA transacción en prod, todo
 *      `ON CONFLICT DO NOTHING`: nunca sobrescribe un dato nativo ("prod manda"),
 *      preserva los UUID (staging se sembró de prod), es idempotente.
 *   4. Marca el lote como 'promoted' en prod. Revertir = borrar por import_batch_id.
 *
 * Por defecto es DRY-RUN: cuenta lo que entraría sin escribir. Escribe solo con
 * --commit.
 *
 * Uso (desde el portátil, túnel abierto, PGPASSWORD en el entorno):
 *   export STAGING_URL='postgresql://sports_user@localhost:5432/sports_staging'
 *   export PROD_URL='postgresql://sports_user@localhost:5432/sports_results'
 *   npx tsx src/promote-to-prod.ts --batch <label>            # dry-run
 *   npx tsx src/promote-to-prod.ts --batch <label> --commit   # escribe en prod
 */
import pg from 'pg';
import type { Pool as PgPool, PoolClient } from 'pg';
const { Pool } = pg;

const MAX_PLAUSIBLE_SCORE = 40;

// Copia genérica de filas src→dst preservando TODAS las columnas (incl. UUID).
// ON CONFLICT DO NOTHING captura choque por PK (ya existe) o por source_ref único.
async function copyRows(src: PgPool, dst: PoolClient,
                        table: string, selectSql: string, params: unknown[]) {
  const rows = (await src.query(selectSql, params)).rows;
  let inserted = 0;
  for (const row of rows) {
    const cols = Object.keys(row);
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
  const batchLabel = args[args.indexOf('--batch') + 1];
  const commit = args.includes('--commit');
  if (args.indexOf('--batch') < 0 || !batchLabel) throw new Error('Falta --batch <label>');

  const stagingUrl = process.env['STAGING_URL'];
  const prodUrl = process.env['PROD_URL'];
  if (!stagingUrl || !prodUrl) throw new Error('Define STAGING_URL y PROD_URL en el entorno');

  const staging = new Pool({ connectionString: stagingUrl });
  const prod = new Pool({ connectionString: prodUrl });

  try {
    // ── Resolver el lote en staging ──────────────────────────────────────────
    const batch = (await staging.query<{ id: string }>(
      `SELECT id FROM import_batches WHERE label = $1`, [batchLabel])).rows[0];
    if (!batch) throw new Error(`No existe el lote '${batchLabel}' en staging`);
    const batchId = batch.id;
    const bp = [batchId];

    // ── Guardas duras: re-validación antes de escribir ─────────────────────────
    const guard = async (desc: string, sql: string) => {
      const n = Number((await staging.query<{ n: string }>(sql, bp)).rows[0]?.n ?? 0);
      if (n > 0) throw new Error(`ABORTADO — guarda fallida (${n}): ${desc}. Corre validate-staging para el detalle.`);
    };
    await guard('marcadores negativos',
      `SELECT count(*) n FROM matches WHERE import_batch_id=$1 AND (home_score<0 OR away_score<0)`);
    await guard(`marcadores imposibles (>${MAX_PLAUSIBLE_SCORE})`,
      `SELECT count(*) n FROM matches WHERE import_batch_id=$1 AND (home_score>${MAX_PLAUSIBLE_SCORE} OR away_score>${MAX_PLAUSIBLE_SCORE})`);
    await guard('auto-partidos',
      `SELECT count(*) n FROM matches WHERE import_batch_id=$1 AND home_team_id=away_team_id`);
    await guard('terminados sin marcador',
      `SELECT count(*) n FROM matches WHERE import_batch_id=$1 AND status='finished' AND (home_score IS NULL OR away_score IS NULL)`);
    await guard('actas duplicadas por fecha',
      `SELECT COALESCE(SUM(c)-COUNT(*),0) n FROM (
         SELECT count(*) c FROM matches WHERE import_batch_id=$1 AND scheduled_at IS NOT NULL
         GROUP BY season_id, home_team_id, away_team_id, scheduled_at::date HAVING count(*)>1) x`);
    await guard('duplican otro del mismo día con distinto source_ref',
      `SELECT count(*) n FROM matches b WHERE b.import_batch_id=$1 AND b.scheduled_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM matches o WHERE o.season_id=b.season_id AND o.home_team_id=b.home_team_id
                       AND o.away_team_id=b.away_team_id AND o.scheduled_at::date=b.scheduled_at::date
                       AND o.id<>b.id AND o.import_batch_id IS DISTINCT FROM $1 AND o.source_ref IS DISTINCT FROM b.source_ref)`);

    // ── Conjuntos a promover, en orden de FK ───────────────────────────────────
    // Cada SELECT trae las filas de staging que el lote introduce/referencia.
    const sets: { table: string; sql: string }[] = [
      { table: 'data_sources',   sql: `SELECT DISTINCT ds.* FROM data_sources ds
                                          WHERE ds.id IN (
                                            SELECT source_id FROM import_batches WHERE id=$1
                                            UNION SELECT source_id FROM matches WHERE import_batch_id=$1
                                            UNION SELECT t.source_id FROM teams t
                                              JOIN matches m ON (t.id=m.home_team_id OR t.id=m.away_team_id)
                                              WHERE m.import_batch_id=$1)` },
      { table: 'import_batches', sql: `SELECT * FROM import_batches WHERE id = $1` },
      { table: 'competitions',   sql: `SELECT DISTINCT c.* FROM competitions c
                                          JOIN seasons s ON s.competition_id=c.id
                                          JOIN matches m ON m.season_id=s.id WHERE m.import_batch_id=$1` },
      { table: 'seasons',        sql: `SELECT DISTINCT s.* FROM seasons s
                                          JOIN matches m ON m.season_id=s.id WHERE m.import_batch_id=$1` },
      { table: 'rounds',         sql: `SELECT DISTINCT r.* FROM rounds r
                                          JOIN matches m ON m.round_id=r.id WHERE m.import_batch_id=$1` },
      { table: 'teams',          sql: `SELECT DISTINCT t.* FROM teams t
                                          JOIN matches m ON (t.id=m.home_team_id OR t.id=m.away_team_id)
                                          WHERE m.import_batch_id=$1` },
      { table: 'players',        sql: `SELECT DISTINCT p.* FROM players p
                                          JOIN match_events e ON e.player_id=p.id
                                          JOIN matches m ON e.match_id=m.id WHERE m.import_batch_id=$1` },
      { table: 'source_entity_map', sql: `SELECT DISTINCT sem.* FROM source_entity_map sem
                                          JOIN matches m ON (sem.team_id=m.home_team_id OR sem.team_id=m.away_team_id)
                                          WHERE m.import_batch_id=$1` },
      { table: 'matches',        sql: `SELECT * FROM matches WHERE import_batch_id=$1` },
      { table: 'match_events',   sql: `SELECT e.* FROM match_events e
                                          JOIN matches m ON e.match_id=m.id WHERE m.import_batch_id=$1` },
    ];

    // ── Dry-run: solo cuenta ────────────────────────────────────────────────────
    if (!commit) {
      process.stdout.write(`\n─── DRY-RUN promoción lote '${batchLabel}' (staging → prod) ───\n`);
      for (const s of sets) {
        const read = (await staging.query(s.sql, bp)).rowCount ?? 0;
        process.stdout.write(`  ${String(read).padStart(6)}  ${s.table} (candidatos; los ya presentes en prod se saltan)\n`);
      }
      process.stdout.write(`\n  Guardas: OK. Nada escrito. Repite con --commit para promover.\n\n`);
      return;
    }

    // ── Promoción real: una transacción en prod ───────────────────────────────
    const client = await prod.connect();
    try {
      await client.query('BEGIN');
      const report: string[] = [];
      for (const s of sets) {
        const { read, inserted } = await copyRows(staging, client, s.table, s.sql, bp);
        report.push(`  ${String(inserted).padStart(6)} / ${read} insertados  ${s.table}`);
      }
      // Marcar el lote como promocionado en prod.
      await client.query(
        `UPDATE import_batches SET status='promoted', finished_at=NOW() WHERE id=$1`, bp);
      await client.query('COMMIT');

      process.stdout.write(`\n─── Promoción lote '${batchLabel}' COMPLETADA (staging → prod) ───\n`);
      process.stdout.write(report.join('\n') + '\n');
      process.stdout.write(`\n  Lote marcado 'promoted'. Revertir en prod: DELETE FROM matches WHERE import_batch_id='${batchId}';\n\n`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } finally {
    await staging.end();
    await prod.end();
  }
}

main().catch((err) => { console.error('Error en promote-to-prod:', err instanceof Error ? err.message : err); process.exitCode = 1; });
