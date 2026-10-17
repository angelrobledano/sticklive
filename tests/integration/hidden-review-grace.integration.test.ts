/**
 * Ocultar por calidad sin desindexar (F1-6, DQ-01 de docs/AUDITORIA_SEO_2026-10-16.md).
 *
 * Marcar una temporada o competición `en_revision` (migraciones 064/067) hace
 * que la API responda 404 en su ficha. Para Google eso es una baja: si la
 * revisión dura horas y se reabre, la URL tiene que volver a ganarse.
 *
 * La migración 075 guarda CUÁNDO se ocultó (`data_quality_changed_at`) y
 * `GET /redirects/:type/:id` informa de que la ficha existe pero está oculta
 * (`{ status: 'hidden', since }`). La web responde 5xx durante el periodo de
 * gracia (Google reintenta y conserva la URL) y 404 después.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { redirectsRouter } from '../../apps/api/src/routes/redirects.js';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada, crearPartido } from './support/factorias.js';

async function get(path: string) {
  const res = await redirectsRouter.request(path);
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

async function changedAt(table: 'competitions' | 'seasons', id: string): Promise<Date | null> {
  const { rows } = await db.query<{ t: Date | null }>(
    `SELECT data_quality_changed_at AS t FROM ${table} WHERE id = $1`, [id]
  );
  return rows[0]?.t ?? null;
}

beforeEach(limpiar);
afterAll(closeDb);

describe('data_quality_changed_at (migración 075)', () => {
  it('se fija al cambiar data_quality y no al tocar otras columnas', async () => {
    const competitionId = await crearCompeticion(await crearDeporte());
    expect(await changedAt('competitions', competitionId)).toBeNull();

    await db.query(`UPDATE competitions SET name = 'otro' WHERE id = $1`, [competitionId]);
    expect(await changedAt('competitions', competitionId)).toBeNull();

    await db.query(`UPDATE competitions SET data_quality = 'en_revision' WHERE id = $1`, [competitionId]);
    expect(await changedAt('competitions', competitionId)).toBeInstanceOf(Date);
  });

  it('también en temporadas', async () => {
    const seasonId = await crearTemporada(await crearCompeticion(await crearDeporte()));
    await db.query(`UPDATE seasons SET data_quality = 'en_revision' WHERE id = $1`, [seasonId]);
    expect(await changedAt('seasons', seasonId)).toBeInstanceOf(Date);
  });
});

describe('GET /redirects — fichas ocultas por calidad', () => {
  it('partido de una temporada oculta: hidden con la fecha de la ocultación', async () => {
    const { matchId, seasonId } = await crearPartido();
    await db.query(`UPDATE seasons SET data_quality = 'en_revision' WHERE id = $1`, [seasonId]);

    const res = await get(`/match/${matchId}`);
    expect(res.status).toBe(200);
    expect(res.body?.['status']).toBe('hidden');
    expect(Date.now() - Date.parse(String(res.body?.['since']))).toBeLessThan(60_000);
  });

  it('competición oculta: hidden', async () => {
    const { competitionId } = await crearPartido();
    await db.query(`UPDATE competitions SET data_quality = 'en_revision' WHERE id = $1`, [competitionId]);
    expect((await get(`/competition/${competitionId}`)).body?.['status']).toBe('hidden');
  });

  it('competición visible con todas sus temporadas ocultas: hidden', async () => {
    const { competitionId, seasonId } = await crearPartido();
    await db.query(`UPDATE seasons SET data_quality = 'en_revision' WHERE id = $1`, [seasonId]);
    expect((await get(`/competition/${competitionId}`)).body?.['status']).toBe('hidden');
  });

  it('ocultada antes de la 075 (sin fecha): hidden con since null', async () => {
    const { matchId, seasonId } = await crearPartido();
    await db.query(`UPDATE seasons SET data_quality = 'en_revision' WHERE id = $1`, [seasonId]);
    await db.query(`UPDATE seasons SET data_quality_changed_at = NULL WHERE id = $1`, [seasonId]);
    expect((await get(`/match/${matchId}`)).body).toEqual({ status: 'hidden', since: null });
  });

  it('partido visible: no consta (404), la ficha la sirve su endpoint', async () => {
    const { matchId } = await crearPartido();
    expect((await get(`/match/${matchId}`)).status).toBe(404);
  });
});
