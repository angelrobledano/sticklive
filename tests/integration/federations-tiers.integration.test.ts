/**
 * Migración 089 — federaciones + tier + featured_rank.
 *
 * Se re-ejecuta el .sql sobre competiciones sembradas en el test (limpiar()
 * vacía también `federations`): así se prueban a la vez el backfill y la
 * idempotencia.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, closeDb } from '@sports/db';
import { crearDeporte } from './support/factorias.js';
import { limpiar } from './support/db.js';
import { FEDERATIONS } from '../../apps/etl/src/federations.js';

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../packages/db/migrations/089_federations_and_tiers.sql'),
  'utf-8',
);

let sportId: string;

async function comp(slug: string, name: string, over: { organizer?: string; age?: string; scope?: string; gender?: string } = {}) {
  await db.query(
    `INSERT INTO competitions (sport_id, name, slug, organizer, age_category, scope, gender)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [sportId, name, slug, over.organizer ?? 'RFEP', over.age ?? 'senior', over.scope ?? 'national', over.gender ?? 'male'],
  );
}

async function row(slug: string) {
  const { rows } = await db.query<{ tier: number | null; featured_rank: number | null }>(
    'SELECT tier, featured_rank FROM competitions WHERE slug = $1', [slug],
  );
  return rows[0]!;
}

beforeAll(async () => {
  await limpiar();
  sportId = await crearDeporte();
  await comp('ok-liga-masculina', 'OK LIGA MASCULINA');
  await comp('ok-liga-plata-norte', 'OK LIGA PLATA NORTE');
  await comp('ok-liga-bronce-masculina-sur', 'OK LIGA BRONCE MASCULINA SUR');
  await comp('copa-del-rey', 'COPA DEL REY');
  await comp('ok-liga-juvenil', 'OK LIGA JUVENIL', { age: 'juvenil' });
  await comp('fpp-1-divisao', '1ª Divisão', { organizer: 'FPP' });
  await comp('fmp-primera', 'Primera Autonómica', { organizer: 'FMP', scope: 'regional' });
  await db.query(SQL);
  await db.query(SQL); // idempotente
});

afterAll(async () => {
  await closeDb();
});

describe('migración 089 — federaciones', () => {
  it('el árbol es coherente: cada padre existe y los niveles bajan', async () => {
    const { rows } = await db.query<{ code: string; level: string; parent_level: string | null }>(`
      SELECT f.code, f.level, p.level AS parent_level
        FROM federations f LEFT JOIN federations p ON p.code = f.parent_code`);
    const order = ['world', 'continental', 'national', 'regional'];
    for (const r of rows) {
      if (r.level === 'world') { expect(r.parent_level).toBeNull(); continue; }
      expect(order.indexOf(r.parent_level!)).toBe(order.indexOf(r.level) - 1);
    }
  });

  it('cada organizer del registro de autonómicas sidgad tiene federación', async () => {
    const { rows } = await db.query<{ code: string }>('SELECT code FROM federations');
    const codes = new Set(rows.map((r) => r.code));
    for (const f of FEDERATIONS) expect(codes.has(f.org), f.org).toBe(true);
    for (const o of ['RFEP', 'FPP', 'FVP', 'WSE', 'World Skate']) expect(codes.has(o), o).toBe(true);
  });
});

describe('migración 089 — tier y featured_rank', () => {
  it('tier por nomenclatura sénior; base y regionales sin tier', async () => {
    expect((await row('ok-liga-masculina')).tier).toBe(1);
    expect((await row('ok-liga-plata-norte')).tier).toBe(2);
    expect((await row('ok-liga-bronce-masculina-sur')).tier).toBe(3);
    expect((await row('copa-del-rey')).tier).toBe(1);
    expect((await row('fpp-1-divisao')).tier).toBe(1);
    expect((await row('ok-liga-juvenil')).tier).toBeNull();
    expect((await row('fmp-primera')).tier).toBeNull();
  });

  it('featured_rank desde el antiguo mapa del front y la 1ª de Portugal', async () => {
    expect((await row('ok-liga-masculina')).featured_rank).toBe(5);
    expect((await row('copa-del-rey')).featured_rank).toBe(7);
    expect((await row('ok-liga-plata-norte')).featured_rank).toBeNull();
    expect((await row('fpp-1-divisao')).featured_rank).toBe(20);
  });

  it('no pisa valores editados a mano', async () => {
    await db.query("UPDATE competitions SET tier = 4, featured_rank = 99 WHERE slug = 'ok-liga-plata-norte'");
    await db.query(SQL);
    expect(await row('ok-liga-plata-norte')).toEqual({ tier: 4, featured_rank: 99 });
  });
});
