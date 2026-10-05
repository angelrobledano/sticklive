/**
 * VALIDADOR DE STAGING (A4 · Fase 2).
 *
 * Corre la batería de QA sobre `sports_staging` y emite un veredicto PASA/FALLA.
 * Es de SOLO LECTURA: no escribe nada. Nada se promociona a prod si esto no da
 * PASA (exit 0). En FALLA sale con exit 1 para cortar cualquier pipeline.
 *
 * Uso (desde el portátil, por el túnel SSH, con DATABASE_URL → sports_staging):
 *   npx tsx --env-file=../../.env src/validate-staging.ts --batch <label>
 *   npx tsx --env-file=../../.env src/validate-staging.ts            # audita TODO staging
 *
 * Con --batch <label> acota las comprobaciones al lote recién scrapeado y, además,
 * cruza ese lote contra el resto de staging (el dato sembrado desde prod) para
 * cazar el caso peligroso: un partido re-scrapeado con OTRO source_ref que ya
 * existe en prod bajo otro ref — un duplicado que la promoción por source_ref NO
 * atraparía. Ese fue el fallo de la prueba de re-scrape de la 23/24.
 */
import { db, closeDb } from '@sports/db';
import { STANDINGS_RECONCILE_SQL } from './standings-reconcile.js';

// ── Umbrales (ajustables) ─────────────────────────────────────────────────────
const MAX_PLAUSIBLE_SCORE = 40;   // marcador por encima de esto = imposible en hockey patines
const MAX_ORPHAN_TEAMS    = 20;   // equipos sin ningún partido tolerados antes de FALLA
const MAX_HITL_PENDING    = 50;   // ítems pendientes en la cola HITL antes de FALLA

type Severity = 'FAIL' | 'WARN';
interface Check { key: string; desc: string; count: number; sev: Severity; fail: boolean; sample?: string[] }

async function main() {
  const args = process.argv.slice(2);
  const bi = args.indexOf('--batch');
  const batchLabel = bi >= 0 ? args[bi + 1] : undefined;

  let batchId: string | null = null;
  if (batchLabel) {
    batchId = (await db.query<{ id: string }>(
      `SELECT id FROM import_batches WHERE label = $1`, [batchLabel])).rows[0]?.id ?? null;
    if (!batchId) throw new Error(`No existe import_batch con label='${batchLabel}' en staging`);
  }

  // Ámbito de las comprobaciones a nivel de partido. Con lote: solo sus partidos.
  const scope = batchId ? `m.import_batch_id = $1` : `TRUE`;
  const p: unknown[] = batchId ? [batchId] : [];
  const q = <T extends Record<string, unknown>>(sql: string, params: unknown[] = p) =>
    db.query<T>(sql, params);

  const checks: Check[] = [];
  const add = async (key: string, desc: string, sev: Severity, sql: string,
                     failWhen: (n: number) => boolean = (n) => n > 0, params: unknown[] = p) => {
    const n = Number((await q<{ n: string }>(sql, params)).rows[0]?.n ?? 0);
    const fail = sev === 'FAIL' && failWhen(n);
    checks.push({ key, desc, count: n, sev, fail });
    return n;
  };

  // ── Integridad dura (FALLA) ────────────────────────────────────────────────
  await add('neg_scores', 'Marcadores negativos', 'FAIL',
    `SELECT count(*) n FROM matches m WHERE ${scope} AND (m.home_score < 0 OR m.away_score < 0)`);
  await add('impossible_scores', `Marcadores imposibles (> ${MAX_PLAUSIBLE_SCORE})`, 'FAIL',
    `SELECT count(*) n FROM matches m WHERE ${scope} AND (m.home_score > ${MAX_PLAUSIBLE_SCORE} OR m.away_score > ${MAX_PLAUSIBLE_SCORE})`);
  await add('self_matches', 'Auto-partidos (local = visitante)', 'FAIL',
    `SELECT count(*) n FROM matches m WHERE ${scope} AND m.home_team_id = m.away_team_id`);
  await add('finished_no_score', 'Terminados sin marcador', 'FAIL',
    `SELECT count(*) n FROM matches m WHERE ${scope} AND m.status = 'finished' AND (m.home_score IS NULL OR m.away_score IS NULL)`);

  // Actas duplicadas POR FECHA: mismo (temporada, local, visitante, día). Se usa la
  // fecha porque el archivo histórico colapsa años en una temporada 'Histórico' con
  // scheduled_at NULL — ahí la tripleta se repite legítimamente (un partido por año),
  // y su identidad real es el source_ref (ya único por índice). Por eso este check
  // solo mira partidos CON fecha; los históricos sin fecha se deduplican por source_ref.
  await add('dup_in_scope', 'Actas duplicadas por fecha (temporada/local/visitante/día)', 'FAIL',
    `SELECT COALESCE(SUM(c) - COUNT(*), 0) n FROM (
        SELECT count(*) c FROM matches m WHERE ${scope} AND m.scheduled_at IS NOT NULL
        GROUP BY m.season_id, m.home_team_id, m.away_team_id, m.scheduled_at::date
        HAVING count(*) > 1) x`);

  // Cruce contra el resto de staging (solo con --batch): el partido del lote (con
  // fecha) ya existe fuera del lote el MISMO día con OTRO source_ref → duplicado que
  // la promoción por source_ref no ve. Comprobación estrella (fallo de la 23/24).
  if (batchId) {
    await add('cross_dup', 'Partidos del lote que duplican otro del mismo día (distinto source_ref)', 'FAIL',
      `SELECT count(*) n FROM matches b
        WHERE b.import_batch_id = $1 AND b.scheduled_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM matches o
                        WHERE o.season_id = b.season_id
                          AND o.home_team_id = b.home_team_id
                          AND o.away_team_id = b.away_team_id
                          AND o.scheduled_at::date = b.scheduled_at::date
                          AND o.id <> b.id
                          AND (o.import_batch_id IS DISTINCT FROM $1)
                          AND o.source_ref IS DISTINCT FROM b.source_ref)`);
  }

  // Avalancha HITL: pendientes en la cola de resolución (no acotable por lote).
  await add('hitl_pending', `Cola HITL pendiente (umbral ${MAX_HITL_PENDING})`, 'FAIL',
    `SELECT count(*) n FROM resolution_queue WHERE status = 'pending'`,
    (n) => n > MAX_HITL_PENDING, []);

  // ── Avisos (WARN, no cortan por sí solos salvo umbral) ─────────────────────
  // Equipos huérfanos: creados pero sin ningún partido (posible ref que no casó).
  await add('orphan_teams', `Equipos huérfanos (umbral ${MAX_ORPHAN_TEAMS})`, 'FAIL',
    `SELECT count(*) n FROM teams t
      WHERE NOT EXISTS (SELECT 1 FROM matches m WHERE m.home_team_id = t.id OR m.away_team_id = t.id)`,
    (n) => n > MAX_ORPHAN_TEAMS, []);

  // Cobertura de eventos: partidos con event_coverage='full' cuyos goles por lado
  // no cuadran con el marcador. WARN — el modelado de penaltis puede diferir.
  await add('event_coverage_mismatch', "Cobertura 'full' con eventos que no cuadran con el marcador", 'WARN',
    `WITH ev AS (
        SELECT match_id, team_id, count(*) g FROM match_events WHERE event_type = 'goal' GROUP BY 1, 2)
      SELECT count(*) n FROM matches m
       WHERE ${scope} AND m.event_coverage = 'full' AND m.status = 'finished'
         AND ( COALESCE((SELECT g FROM ev WHERE ev.match_id = m.id AND ev.team_id = m.home_team_id), 0) <> COALESCE(m.home_score, 0)
            OR COALESCE((SELECT g FROM ev WHERE ev.match_id = m.id AND ev.team_id = m.away_team_id), 0) <> COALESCE(m.away_score, 0) )`);

  // #226: clasificación ↔ partidos de su MISMA temporada. FAIL acotado al lote
  // (sus temporadas deben reconciliar antes de promocionar nada); WARN en la
  // auditoría global (es la deuda histórica conocida, no del lote en curso).
  await add('standings_reconcile',
    'Clasificaciones que no reconcilian con los partidos de su temporada (PJ/V/E/D/GF/GC)',
    batchId ? 'FAIL' : 'WARN',
    STANDINGS_RECONCILE_SQL, (n) => n > 0, [batchId]);

  // ── Informe ────────────────────────────────────────────────────────────────
  const failed = checks.filter((c) => c.fail);
  const verdict = failed.length === 0 ? 'PASA' : 'FALLA';

  const scopeLabel = batchLabel ? `lote '${batchLabel}'` : 'TODO staging';
  process.stdout.write(`\n─── Validación de staging (${scopeLabel}) ───\n`);
  for (const c of checks) {
    const mark = c.fail ? '✗ FALLA' : (c.count > 0 ? (c.sev === 'WARN' ? '! aviso' : '· ok') : '· ok');
    process.stdout.write(`  ${mark.padEnd(8)} ${String(c.count).padStart(6)}  ${c.desc}\n`);
  }
  process.stdout.write(`\n  Veredicto: ${verdict}${failed.length ? ` (${failed.length} comprobación(es) en FALLA)` : ''}\n\n`);

  if (verdict === 'FALLA') process.exitCode = 1;
}

main()
  .catch((err) => { console.error('Error en validate-staging:', err); process.exitCode = 2; })
  .finally(() => closeDb());
