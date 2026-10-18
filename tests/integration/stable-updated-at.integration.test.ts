/**
 * `updated_at` estable (F2-1, migración 077).
 *
 * El ETL mueve `updated_at` y `scraped_at` en cada upsert. El trigger debe
 * conservar `updated_at` cuando no cambia ningún otro campo —para que el
 * `lastmod` del sitemap no se reescriba en cada pasada— y moverlo cuando el
 * dato visible sí cambia.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearPartido } from './support/factorias.js';

beforeEach(async () => {
  await limpiar();
});

afterAll(async () => {
  await closeDb();
});

async function updatedAt(table: 'matches' | 'teams', id: string): Promise<string> {
  const { rows } = await db.query<{ updated_at: string }>(
    `SELECT updated_at::text AS updated_at FROM ${table} WHERE id = $1`,
    [id]
  );
  return rows[0]!.updated_at;
}

describe('updated_at solo cambia con el dato (F2-1)', () => {
  it('conserva updated_at si el UPDATE solo mueve updated_at/scraped_at', async () => {
    const { matchId } = await crearPartido();
    const before = await updatedAt('matches', matchId);

    await db.query('UPDATE matches SET updated_at = NOW(), scraped_at = NOW() WHERE id = $1', [matchId]);

    expect(await updatedAt('matches', matchId)).toBe(before);
  });

  it('mueve updated_at cuando cambia un campo visible', async () => {
    const { matchId } = await crearPartido();
    const before = await updatedAt('matches', matchId);

    await db.query('UPDATE matches SET home_score = 3, updated_at = NOW() WHERE id = $1', [matchId]);
    const after = await updatedAt('matches', matchId);

    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it('también protege equipos', async () => {
    const { homeTeamId } = await crearPartido();
    const before = await updatedAt('teams', homeTeamId);

    await db.query('UPDATE teams SET updated_at = NOW(), scraped_at = NOW() WHERE id = $1', [homeTeamId]);
    expect(await updatedAt('teams', homeTeamId)).toBe(before);

    await db.query("UPDATE teams SET name = name || ' X', updated_at = NOW() WHERE id = $1", [homeTeamId]);
    const after = await updatedAt('teams', homeTeamId);
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });
});
