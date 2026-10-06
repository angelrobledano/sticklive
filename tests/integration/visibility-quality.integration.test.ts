/**
 * Visibilidad por calidad de datos (migración 067).
 *
 * Cubre hoy: las funciones de calidad de @sports/db (listados y marcado) y el
 * helper de la API `seasonVisible`. Los lotes de rutas (Tasks 4-10) ampliarán
 * este fichero con las vías HTTP.
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  db, closeDb,
  listCompetitionsForQuality, setCompetitionQuality,
  listSeasonsForQuality, setSeasonQuality,
} from '@sports/db';
import { seasonVisible } from '../../apps/api/src/lib/visibility.js';
import { competitionsRouter } from '../../apps/api/src/routes/competitions.js';
import { seasonOverviewRouter } from '../../apps/api/src/routes/season-overview.js';
import { seasonStatsRouter } from '../../apps/api/src/routes/season-stats.js';
import { standingsRouter } from '../../apps/api/src/routes/standings.js';
import { matchesRouter } from '../../apps/api/src/routes/matches.js';
import { limpiar } from './support/db.js';
import {
  crearDeporte, crearCompeticion, crearTemporada,
  crearPartido, // usado en el lote de rutas (Tasks 4-10)
} from './support/factorias.js';

// usado en el lote de rutas (Tasks 4-10)
async function get(router: { request: (p: string, init?: RequestInit) => Promise<Response> }, path: string) {
  const res = await router.request(path);
  return { status: res.status, body: await res.json().catch(() => null) };
}

// usado en el lote de rutas (Tasks 4-10)
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

describe('seasonVisible', () => {
  it('temporada y competición en ok → true', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);

    expect(await seasonVisible(seasonId)).toBe(true);
  });

  it('temporada en_revision → false', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    await setSeasonQualityDirect(seasonId, 'en_revision');

    expect(await seasonVisible(seasonId)).toBe(false);
  });

  it('competición en_revision con temporada ok → false', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    await setCompQualityDirect(compId, 'en_revision');

    expect(await seasonVisible(seasonId)).toBe(false);
  });

  it('id inexistente (uuid válido aleatorio) → false', async () => {
    expect(await seasonVisible(randomUUID())).toBe(false);
  });
});

describe('GET /competitions — filtrado por calidad', () => {
  it('excluye competiciones ocultas y no devuelve su temporada de referencia', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    await crearPartido({ seasonId });

    const visible = await get(competitionsRouter, '/');
    const vBody = visible.body as { competitions: Array<{ id: string }> };
    expect(vBody.competitions.some((c) => c.id === compId)).toBe(true);

    await setCompQualityDirect(compId, 'en_revision');

    const hidden = await get(competitionsRouter, '/');
    const hBody = hidden.body as { competitions: Array<{ id: string }> };
    expect(hBody.competitions.some((c) => c.id === compId)).toBe(false);
  });

  it('solo lista temporadas visibles y 404 si la competición queda vacía', async () => {
    const compId = await crearCompeticion(sportId);
    const s1 = await crearTemporada(compId);
    const s2 = await crearTemporada(compId, { esActual: false });
    await crearPartido({ seasonId: s1 });
    await crearPartido({ seasonId: s2 });

    await setSeasonQualityDirect(s2, 'en_revision');

    const res = await get(competitionsRouter, `/${compId}/seasons`);
    expect(res.status).toBe(200);
    const body = res.body as { seasons: Array<{ id: string }> };
    expect(body.seasons.map((s) => s.id)).toEqual([s1]);

    await setSeasonQualityDirect(s1, 'en_revision');
    const empty = await get(competitionsRouter, `/${compId}/seasons`);
    expect(empty.status).toBe(404);
  });
});

describe('endpoints de temporada — visibilidad', () => {
  it('404 en overview/stats/standings/matches cuando la temporada está oculta', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    await crearPartido({ seasonId });

    expect((await get(seasonOverviewRouter, `/${seasonId}/overview`)).status).toBe(200);
    expect((await get(seasonStatsRouter, `/${seasonId}/stats`)).status).toBe(200);

    await setSeasonQualityDirect(seasonId, 'en_revision');

    expect((await get(seasonOverviewRouter, `/${seasonId}/overview`)).status).toBe(404);
    expect((await get(seasonStatsRouter, `/${seasonId}/stats`)).status).toBe(404);
    expect((await get(standingsRouter, `/${seasonId}/standings`)).status).toBe(404);
    expect((await get(matchesRouter, `/${seasonId}/matches`)).status).toBe(404);
  });

  it('la competición oculta todo su contenido aunque la temporada esté ok', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    await crearPartido({ seasonId });
    await setCompQualityDirect(compId, 'en_revision');

    expect((await get(seasonOverviewRouter, `/${seasonId}/overview`)).status).toBe(404);
    expect((await get(standingsRouter, `/${seasonId}/standings`)).status).toBe(404);
  });
});
