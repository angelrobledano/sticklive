/**
 * ENRICH-PROMOTE (A5 · Fase 3) — la ÚNICA pieza que reescribe filas nativas de
 * prod. Se prueba EJECUTANDO EL SCRIPT REAL como subproceso (sin tocar su
 * código), con STAGING_URL y PROD_URL apuntando a dos BD de prueba desechables
 * creadas aquí. Así se ejercita exactamente el camino de producción:
 * re-validación de guardas en staging, transacción en prod, lista blanca,
 * idempotencia y revert.
 *
 * Cubre T-001..T-008 de docs/AUDITORIA_TESTS.md.
 *
 * No usa el pool compartido (@sports/db) para las dos BD objetivo: crea sus
 * propios pools contra las dos bases que gestiona por sí mismo.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Deriva las URLs de las dos BD de prueba del DATABASE_URL del harness.
function dbUrl(name: string): string {
  const base = process.env['DATABASE_URL'];
  if (!base) throw new Error('DATABASE_URL no definida');
  const u = new URL(base);
  u.pathname = '/' + name;
  return u.toString();
}
const STAGING_DB = 'el_staging_test';
const PROD_DB = 'el_prod_test';
const STAGING_URL = dbUrl(STAGING_DB);
const PROD_URL = dbUrl(PROD_DB);

// UUIDs fijos compartidos por ambas BD (staging se siembra "desde prod").
const SPORT = '00000000-0000-0000-0000-0000000000a1';
const COMP = '00000000-0000-0000-0000-0000000000c1';
const S_HIST = '00000000-0000-0000-0000-0000000000d0'; // temporada 'historico'
const S_REAL = '00000000-0000-0000-0000-0000000000d1'; // temporada real destino
const T_A = '00000000-0000-0000-0000-0000000000e1';
const T_B = '00000000-0000-0000-0000-0000000000e2';
const BATCH = '00000000-0000-0000-0000-0000000000b1';
const M1 = '00000000-0000-0000-0000-000000000101';
const M2 = '00000000-0000-0000-0000-000000000102';
const REF1 = 'ref-0001';
const REF2 = 'ref-0002';
const LABEL = 'enrich-test-batch';

let staging: pg.Pool;
let prod: pg.Pool;

// `execFileSync('npx')` necesita shell en Windows (npx es un .cmd, no un exe).
const NPX_OPTS = { cwd: ROOT, shell: process.platform === 'win32' } as const;

function migrate(url: string) {
  execFileSync('npx', ['tsx', 'packages/db/src/migrate.ts'], {
    ...NPX_OPTS,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}

function runScript(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync('npx', ['tsx', 'apps/etl/src/enrich-promote.ts', ...args], {
      ...NPX_OPTS,
      env: { ...process.env, STAGING_URL, PROD_URL },
      stdio: 'pipe',
    }).toString();
    return { code: 0, out };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      code: err.status ?? 1,
      out: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? ''),
    };
  }
}

async function seedBase(p: pg.Pool) {
  // Datos comunes a ambas BD: deporte, competición, equipos y las dos temporadas.
  await p.query(`INSERT INTO sports (id, name, slug) VALUES ($1,'Hockey','hockey') ON CONFLICT DO NOTHING`, [SPORT]);
  await p.query(`INSERT INTO competitions (id, sport_id, name, slug) VALUES ($1,$2,'OK Liga','ok-liga') ON CONFLICT DO NOTHING`, [COMP, SPORT]);
  await p.query(`INSERT INTO seasons (id, competition_id, name, slug) VALUES ($1,$2,'Histórico','historico') ON CONFLICT DO NOTHING`, [S_HIST, COMP]);
  await p.query(`INSERT INTO seasons (id, competition_id, name, slug) VALUES ($1,$2,'2004/05','2004-05') ON CONFLICT DO NOTHING`, [S_REAL, COMP]);
  await p.query(`INSERT INTO teams (id, sport_id, name, slug) VALUES ($1,$2,'Equipo A','equipo-a') ON CONFLICT DO NOTHING`, [T_A, SPORT]);
  await p.query(`INSERT INTO teams (id, sport_id, name, slug) VALUES ($1,$2,'Equipo B','equipo-b') ON CONFLICT DO NOTHING`, [T_B, SPORT]);
}

/**
 * Estado de partida:
 *  - staging: el lote 'enrich' con sus 2 partidos YA en la temporada real, con
 *    fecha y marcador; standings de la temporada real reconciliada con esos
 *    marcadores.
 *  - prod: los MISMOS partidos (por source_ref) en 'historico', sin fecha ni
 *    marcador (solo-marcador del volcado 048).
 */
async function seedScenario() {
  // staging
  await staging.query(`INSERT INTO import_batches (id, label, kind, status) VALUES ($1,$2,'enrich','completed')`, [BATCH, LABEL]);
  const mk = async (id: string, ref: string, date: string, hs: number, as_: number) =>
    staging.query(
      `INSERT INTO matches (id, season_id, home_team_id, away_team_id, scheduled_at, status, home_score, away_score, source_ref, import_batch_id)
       VALUES ($1,$2,$3,$4,$5,'finished',$6,$7,$8,$9)`,
      [id, S_REAL, T_A, T_B, date, hs, as_, ref, BATCH]);
  await mk(M1, REF1, '2004-10-03T18:00:00Z', 3, 1);
  await mk(M2, REF2, '2004-10-10T18:00:00Z', 2, 2);
  // standings de la temporada real, reconciliadas con los marcadores de arriba.
  //   A: GF=3+2=5  GA=1+2=3 ;  B: GF=1+2=3  GA=3+2=5
  await staging.query(`INSERT INTO standings (season_id, team_id, goals_for, goals_against) VALUES ($1,$2,5,3)`, [S_REAL, T_A]);
  await staging.query(`INSERT INTO standings (season_id, team_id, goals_for, goals_against) VALUES ($1,$2,3,5)`, [S_REAL, T_B]);

  // prod: los mismos partidos en 'historico', solo-marcador (sin fecha ni score).
  const mkProd = async (id: string, ref: string) =>
    prod.query(
      `INSERT INTO matches (id, season_id, home_team_id, away_team_id, scheduled_at, status, home_score, away_score, source_ref)
       VALUES ($1,$2,$3,$4,NULL,'finished',NULL,NULL,$5)`,
      [id, S_HIST, T_A, T_B, ref]);
  await mkProd(M1, REF1);
  await mkProd(M2, REF2);
}

async function resetData() {
  for (const p of [staging, prod]) {
    await p.query(`TRUNCATE import_batches, enrich_changes, standings, matches, match_events, match_lineups, players RESTART IDENTITY CASCADE`);
  }
}

beforeAll(async () => {
  // Crear las dos BD desde una conexión de mantenimiento a la BD base del harness.
  const admin = new Pool({ connectionString: process.env['DATABASE_URL'] });
  for (const db of [STAGING_DB, PROD_DB]) {
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`).catch(async () => {
      await admin.query(`DROP DATABASE IF EXISTS ${db}`);
    });
    await admin.query(`CREATE DATABASE ${db}`);
  }
  await admin.end();
  migrate(STAGING_URL);
  migrate(PROD_URL);
  staging = new Pool({ connectionString: STAGING_URL });
  prod = new Pool({ connectionString: PROD_URL });
  await seedBase(staging);
  await seedBase(prod);
}, 120_000);

afterAll(async () => {
  await staging?.end();
  await prod?.end();
  const admin = new Pool({ connectionString: process.env['DATABASE_URL'] });
  for (const db of [STAGING_DB, PROD_DB]) {
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`).catch(() => {});
  }
  await admin.end();
});

beforeEach(async () => {
  await resetData();
  await seedScenario();
});

async function prodMatch(id: string) {
  return (await prod.query(`SELECT * FROM matches WHERE id = $1`, [id])).rows[0];
}

describe('enrich-promote (A5 fase 3)', () => {
  test('T-005 --commit aplica SOLO la lista blanca (season_id, scheduled_at, marcador, updated_at)', async () => {
    const before = await prodMatch(M1);
    const r = runScript(['--batch', LABEL, '--commit']);
    expect(r.code).toBe(0);
    const after = await prodMatch(M1);
    // Movido a la temporada real, con fecha y marcador de staging.
    expect(after.season_id).toBe(S_REAL);
    expect(after.scheduled_at).not.toBeNull();
    expect(after.home_score).toBe(3);
    expect(after.away_score).toBe(1);
    // Ninguna otra columna cambió salvo la lista blanca + updated_at.
    const permitido = new Set(['season_id', 'scheduled_at', 'home_score', 'away_score', 'updated_at']);
    const cambiadas = Object.keys(before).filter(
      (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    expect(cambiadas.every((k) => permitido.has(k))).toBe(true);
  });

  test('T-007 registra el valor anterior en enrich_changes y marca el lote promoted', async () => {
    runScript(['--batch', LABEL, '--commit']);
    const ch = (await prod.query(`SELECT * FROM enrich_changes WHERE batch_id = $1 ORDER BY match_id`, [BATCH])).rows;
    expect(ch.length).toBe(2);
    expect(ch[0].old_season_id).toBe(S_HIST);
    expect(ch[0].old_scheduled_at).toBeNull();
    const batch = (await prod.query(`SELECT status FROM import_batches WHERE id = $1`, [BATCH])).rows[0];
    expect(batch.status).toBe('promoted');
  });

  test('T-006 idempotente: una segunda pasada no vuelve a mover (0 enriquecidos)', async () => {
    runScript(['--batch', LABEL, '--commit']);
    const r2 = runScript(['--batch', LABEL, '--commit']);
    expect(r2.code).toBe(0);
    // Sigue habiendo exactamente 2 filas en enrich_changes (no se duplican).
    const n = (await prod.query(`SELECT count(*)::int c FROM enrich_changes WHERE batch_id = $1`, [BATCH])).rows[0].c;
    expect(n).toBe(2);
    // Nada quedó ya en 'historico' de esos refs.
    const hist = (await prod.query(
      `SELECT count(*)::int c FROM matches m JOIN seasons s ON s.id=m.season_id
        WHERE m.source_ref = ANY($1) AND s.slug='historico'`, [[REF1, REF2]])).rows[0].c;
    expect(hist).toBe(0);
  });

  test('T-008 --revert --commit restaura season_id/scheduled_at/marcador y marca reverted', async () => {
    runScript(['--batch', LABEL, '--commit']);
    const r = runScript(['--batch', LABEL, '--revert', '--commit']);
    expect(r.code).toBe(0);
    const m1 = await prodMatch(M1);
    expect(m1.season_id).toBe(S_HIST);
    expect(m1.scheduled_at).toBeNull();
    expect(m1.home_score).toBeNull();
    expect(m1.away_score).toBeNull();
    const batch = (await prod.query(`SELECT status FROM import_batches WHERE id = $1`, [BATCH])).rows[0];
    expect(batch.status).toBe('reverted');
  });

  test('T-001 guarda: aborta si un partido del lote sigue en historico en staging (sin escribir)', async () => {
    await staging.query(`UPDATE matches SET season_id = $1 WHERE id = $2`, [S_HIST, M1]);
    const r = runScript(['--batch', LABEL, '--commit']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/hist[oó]rico/i);
    // Prod intacto: los partidos siguen en historico, sin fecha.
    const m1 = await prodMatch(M1);
    expect(m1.season_id).toBe(S_HIST);
    expect(m1.scheduled_at).toBeNull();
  });

  test('T-002 guarda: aborta si un partido del lote no tiene fecha', async () => {
    await staging.query(`UPDATE matches SET scheduled_at = NULL WHERE id = $1`, [M1]);
    const r = runScript(['--batch', LABEL, '--commit']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/sin fecha/i);
    expect((await prodMatch(M1)).season_id).toBe(S_HIST);
  });

  test('T-003 guarda: aborta ante colisión de fecha en la temporada destino', async () => {
    // Otro partido A-B el mismo día que M1 en la temporada real → colisión.
    await staging.query(
      `INSERT INTO matches (id, season_id, home_team_id, away_team_id, scheduled_at, status, source_ref)
       VALUES ($1,$2,$3,$4,$5,'finished','ref-colision')`,
      ['00000000-0000-0000-0000-000000000103', S_REAL, T_A, T_B, '2004-10-03T20:00:00Z']);
    const r = runScript(['--batch', LABEL, '--commit']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/colisi/i);
    expect((await prodMatch(M1)).season_id).toBe(S_HIST);
  });

  test('T-004 guarda: aborta si la clasificación no reconcilia con los marcadores', async () => {
    await staging.query(`UPDATE standings SET goals_for = goals_for + 1 WHERE team_id = $1 AND season_id = $2`, [T_A, S_REAL]);
    const r = runScript(['--batch', LABEL, '--commit']);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/clasificaci|reconcil/i);
    expect((await prodMatch(M1)).season_id).toBe(S_HIST);
  });
});
