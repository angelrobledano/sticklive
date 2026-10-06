/**
 * Visibilidad por calidad de datos: competiciones y temporadas marcadas
 * 'en_revision' dejan de ser consultables por cualquier vía.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  db, closeDb,
  listCompetitionsForQuality, setCompetitionQuality,
  listSeasonsForQuality, setSeasonQuality,
} from '@sports/db';
import { limpiar } from './support/db.js';
import {
  crearDeporte, crearCompeticion, crearTemporada, crearPartido,
} from './support/factorias.js';

async function get(router: { request: (p: string, init?: RequestInit) => Promise<Response> }, path: string) {
  const res = await router.request(path);
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function setCompQualityDirect(id: string, q: string) {
  await db.query(`UPDATE competitions SET data_quality = $2 WHERE id = $1`, [id, q]);
}
async function setSeasonQualityDirect(id: string, q: string) {
  await db.query(`UPDATE seasons SET data_quality = $2 WHERE id = $1`, [id, q]);
}

let sportId: string;

beforeEach(async () => {
  await limpiar();
  sportId = await crearDeporte();
});

afterAll(async () => {
  await closeDb();
});

describe('@sports/db — calidad', () => {
  it('listCompetitionsForQuality cuenta temporadas totales y visibles', async () => {
    const compId = await crearCompeticion(sportId);
    const s1 = await crearTemporada(compId);
    // Segunda temporada NO vigente: el índice parcial idx_seasons_one_current
    // solo admite una `is_current` por competición.
    await crearTemporada(compId, { esActual: false });
    await setSeasonQualityDirect(s1, 'en_revision');

    const rows = await listCompetitionsForQuality();
    const row = rows.find((r) => r.id === compId);
    expect(row).toBeDefined();
    expect(row!.data_quality).toBe('ok');
    expect(Number(row!.season_count)).toBe(2);
    expect(Number(row!.visible_season_count)).toBe(1);
  });

  it('setCompetitionQuality y setSeasonQuality cambian el flag', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);

    expect((await setCompetitionQuality(compId, 'en_revision'))?.data_quality).toBe('en_revision');
    expect((await setSeasonQuality(seasonId, 'en_revision'))?.data_quality).toBe('en_revision');

    const seasons = await listSeasonsForQuality(compId);
    expect(seasons.find((s) => s.id === seasonId)!.data_quality).toBe('en_revision');
  });
});
