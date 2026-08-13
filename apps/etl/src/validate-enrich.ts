/**
 * VALIDADOR DE ENRICH (A5 · Fase 2). SOLO LECTURA.
 *
 * Valida un lote `kind='enrich'` en staging CONTRA prod, antes de que
 * `enrich-promote` (Fase 3) escriba nada. Emite veredicto PASA/FALLA (exit ≠ 0
 * en FALLA para cortar el pipeline). La Fase 3 solo llevará a prod dos columnas
 * de cada partido del lote: `season_id` y `scheduled_at` — así que estas guardas
 * miran justo eso: que la fecha y la temporada destino sean correctas, que se
 * saque de 'Histórico' y no de otra temporada, y que no se creen duplicados.
 *
 * Uso (desde apps/etl, por el túnel, con STAGING_URL y PROD_URL en el entorno):
 *   npx tsx src/validate-enrich.ts --batch <label>
 */
import pg from 'pg';
const { Pool } = pg;

const HISTORICO = 'Histórico';

type Severity = 'FAIL' | 'WARN';
interface Check { desc: string; count: number; sev: Severity; fail: boolean }

async function main() {
  const args = process.argv.slice(2);
  const bi = args.indexOf('--batch');
  const batchLabel = bi >= 0 ? args[bi + 1] : undefined;
  if (!batchLabel) throw new Error('Falta --batch <label>');

  const stagingUrl = process.env['STAGING_URL'];
  const prodUrl = process.env['PROD_URL'];
  if (!stagingUrl || !prodUrl) throw new Error('Define STAGING_URL y PROD_URL en el entorno');

  const staging = new Pool({ connectionString: stagingUrl });
  const prod = new Pool({ connectionString: prodUrl });
  const checks: Check[] = [];
  const add = (desc: string, sev: Severity, count: number) =>
    checks.push({ desc, count, sev, fail: sev === 'FAIL' && count > 0 });

  try {
    const batch = (await staging.query<{ id: string }>(
      `SELECT id FROM import_batches WHERE label = $1 AND kind = 'enrich'`, [batchLabel])).rows[0];
    if (!batch) throw new Error(`No existe lote enrich con label='${batchLabel}' en staging (¿kind correcto?)`);
    const batchId = batch.id;

    // Partidos del lote en staging: ya movidos a su temporada real y etiquetados.
    const rows = (await staging.query<{
      source_ref: string; season: string; home: string; away: string;
      hs: number | null; as_: number | null; status: string;
      sched: string | null; sched_year: string | null;
    }>(
      `SELECT m.source_ref, se.name AS season,
              m.home_team_id AS home, m.away_team_id AS away,
              m.home_score AS hs, m.away_score AS as_, m.status,
              m.scheduled_at::text AS sched, to_char(m.scheduled_at, 'YYYY') AS sched_year
         FROM matches m JOIN seasons se ON se.id = m.season_id
        WHERE m.import_batch_id = $1`, [batchId])).rows;
    const total = rows.length;
    const refs = rows.map((r) => r.source_ref).filter(Boolean);

    // ── Integridad del destino en staging (FALLA) ──────────────────────────────
    // No se movieron: siguen en 'Histórico'.
    add("Partidos del lote aún en 'Histórico' en staging (no se movieron)", 'FAIL',
      rows.filter((r) => r.season === HISTORICO).length);

    // Sin fecha tras el enrich (no se recuperó scheduled_at).
    add('Partidos del lote sin fecha tras el enrich', 'FAIL',
      rows.filter((r) => !r.sched).length);

    // Temporada destino incoherente con el año de la fecha (p. ej. 2022/23 con fecha 2019).
    add('Temporada destino incoherente con el año de scheduled_at', 'FAIL',
      rows.filter((r) => {
        if (r.season === HISTORICO || !r.sched_year) return false;
        const m = r.season.match(/(\d{4})\/(\d{2})/);
        if (!m) return false;
        const y1 = Number(m[1]);
        return Number(r.sched_year) !== y1 && Number(r.sched_year) !== y1 + 1;
      }).length);

    // Colisión de fecha en la temporada destino: el partido del lote coincide con
    // OTRO del mismo local/visitante/día en la misma temporada → duplicado tras promover.
    const collide = Number((await staging.query<{ n: string }>(
      `SELECT count(*) n FROM matches b
        WHERE b.import_batch_id = $1 AND b.scheduled_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM matches o
                        WHERE o.id <> b.id AND o.season_id = b.season_id
                          AND o.home_team_id = b.home_team_id AND o.away_team_id = b.away_team_id
                          AND o.scheduled_at::date = b.scheduled_at::date)`, [batchId])).rows[0]?.n ?? 0);
    add('Colisiones de fecha en la temporada destino (mismo local/visitante/día)', 'FAIL', collide);

    // ── Origen en prod (FALLA) ─────────────────────────────────────────────────
    // Los refs del lote que en prod NO están en 'Histórico' → mover un partido que
    // ya vive en una temporada real es justo lo que el enrich no debe hacer.
    const originNotHist = refs.length ? Number((await prod.query<{ n: string }>(
      `SELECT count(*) n FROM matches m JOIN seasons se ON se.id = m.season_id
        WHERE m.source_ref = ANY($1) AND se.name <> $2`, [refs, HISTORICO])).rows[0]?.n ?? 0) : 0;
    add("Partidos del lote que en prod NO vienen de 'Histórico'", 'FAIL', originNotHist);

    // ── Avisos (WARN) ──────────────────────────────────────────────────────────
    // Marcador/equipos distintos en staging vs prod. La Fase 3 solo promueve
    // fecha+temporada (no toca esto), pero una discrepancia merece un vistazo.
    const prodByRef = new Map<string, { hs: number | null; as_: number | null; home: string; away: string }>();
    if (refs.length) {
      for (const r of (await prod.query<{ source_ref: string; hs: number | null; as_: number | null; home: string; away: string }>(
        `SELECT source_ref, home_score AS hs, away_score AS as_, home_team_id AS home, away_team_id AS away
           FROM matches WHERE source_ref = ANY($1)`, [refs])).rows) {
        prodByRef.set(r.source_ref, { hs: r.hs, as_: r.as_, home: r.home, away: r.away });
      }
    }
    add('Marcador/equipos distintos vs prod (la Fase 3 no los toca; solo aviso)', 'WARN',
      rows.filter((r) => {
        const p = prodByRef.get(r.source_ref);
        return p ? (p.hs !== r.hs || p.as_ !== r.as_ || p.home !== r.home || p.away !== r.away) : false;
      }).length);

    // Refs del lote que no existen en prod: son ALTAS, no enriquecimientos; la
    // Fase 3 (UPDATE por ref) no los tocará. Se prometen por A4 si hiciera falta.
    add('Partidos del lote que no existen en prod (son altas, no enrich)', 'WARN',
      rows.filter((r) => r.source_ref && !prodByRef.has(r.source_ref)).length);

    // ── Informe ────────────────────────────────────────────────────────────────
    const failed = checks.filter((c) => c.fail);
    const verdict = failed.length === 0 ? 'PASA' : 'FALLA';
    process.stdout.write(`\n─── Validación enrich · lote '${batchLabel}' (${total} partidos) ───\n`);
    for (const c of checks) {
      const mark = c.fail ? '✗ FALLA' : (c.count > 0 ? (c.sev === 'WARN' ? '! aviso' : '· ok') : '· ok');
      process.stdout.write(`  ${mark.padEnd(8)} ${String(c.count).padStart(6)}  ${c.desc}\n`);
    }
    process.stdout.write(`\n  Veredicto: ${verdict}${failed.length ? ` (${failed.length} en FALLA)` : ''}\n\n`);
    if (verdict === 'FALLA') process.exitCode = 1;
  } finally {
    await staging.end();
    await prod.end();
  }
}

main().catch((err) => { console.error('Error en validate-enrich:', err instanceof Error ? err.message : err); process.exitCode = 2; });
