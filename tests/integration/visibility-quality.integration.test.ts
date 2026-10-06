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
import { matchDetailRouter } from '../../apps/api/src/routes/match-detail.js';
import { searchRouter } from '../../apps/api/src/routes/search.js';
import { teamDetailRouter } from '../../apps/api/src/routes/team-detail.js';
import { playerDetailRouter } from '../../apps/api/src/routes/player-detail.js';
import { metaRouter } from '../../apps/api/src/routes/meta.js';
import { limpiar } from './support/db.js';
import {
  crearDeporte, crearCompeticion, crearTemporada,
  crearPartido, // usado en el lote de rutas (Tasks 4-10)
} from './support/factorias.js';

// El TTL de la micro-caché de /live se lee AL IMPORTAR `live.ts`, así que se
// fija a 0 ANTES del import dinámico para que el test sea determinista (sin
// esto, el segundo GET podría servir el valor cacheado del primero).
process.env['LIVE_CACHE_TTL_MS'] = '0';
const { liveRouter } = await import('../../apps/api/src/routes/live.js');

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

  it('el listado elige la temporada visible si la de referencia está oculta', async () => {
    const compId = await crearCompeticion(sportId);
    const sCurrent = await crearTemporada(compId);                 // is_current = true (defecto)
    const sOld = await crearTemporada(compId, { esActual: false });
    await crearPartido({ seasonId: sCurrent });
    await crearPartido({ seasonId: sOld });

    await setSeasonQualityDirect(sCurrent, 'en_revision');

    const res = await get(competitionsRouter, '/');
    const body = res.body as { competitions: Array<{ id: string; season: { id: string } | null }> };
    const row = body.competitions.find((c) => c.id === compId);
    expect(row).toBeDefined();
    expect(row!.season?.id).toBe(sOld);
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

  it('la guarda de standings hace 404 en temporada oculta con clasificación real', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    const { homeTeamId } = await crearPartido({ seasonId });
    await db.query(
      `INSERT INTO standings (season_id, team_id, position, points) VALUES ($1, $2, 1, 3)`,
      [seasonId, homeTeamId]
    );

    const visible = await get(standingsRouter, `/${seasonId}/standings`);
    expect(visible.status).toBe(200);
    expect((visible.body as { count: number }).count).toBe(1);

    await setSeasonQualityDirect(seasonId, 'en_revision');
    expect((await get(standingsRouter, `/${seasonId}/standings`)).status).toBe(404);
  });
});

describe('partidos — visibilidad', () => {
  it('404 en la ficha del partido cuando su temporada está oculta', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    const { matchId } = await crearPartido({ seasonId });

    expect((await get(matchDetailRouter, `/${matchId}`)).status).toBe(200);

    await setSeasonQualityDirect(seasonId, 'en_revision');
    expect((await get(matchDetailRouter, `/${matchId}`)).status).toBe(404);
  });
});

describe('GET /matches/live — visibilidad', () => {
  it('no devuelve partidos en directo de temporadas ocultas', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    const { matchId } = await crearPartido({ seasonId, status: 'live' });

    const visible = await get(liveRouter, '/live');
    const vBody = visible.body as { matches: Array<{ id: string }> };
    expect(vBody.matches.some((m) => m.id === matchId)).toBe(true);

    await setSeasonQualityDirect(seasonId, 'en_revision');

    const hidden = await get(liveRouter, '/live');
    const hBody = hidden.body as { matches: Array<{ id: string }> };
    expect(hBody.matches.some((m) => m.id === matchId)).toBe(false);
  });
});

describe('GET /search — visibilidad', () => {
  it('no devuelve competiciones ocultas', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    await crearPartido({ seasonId });
    const { rows } = await db.query<{ name: string }>(`SELECT name FROM competitions WHERE id = $1`, [compId]);
    const name = rows[0]!.name;

    const visible = await searchRouter.request(`/?q=${encodeURIComponent(name)}`);
    const vBody = await visible.json() as { competitions: Array<{ id: string }> };
    expect(vBody.competitions.some((c) => c.id === compId)).toBe(true);

    await setCompQualityDirect(compId, 'en_revision');

    const hidden = await searchRouter.request(`/?q=${encodeURIComponent(name)}`);
    const hBody = await hidden.json() as { competitions: Array<{ id: string }> };
    expect(hBody.competitions.some((c) => c.id === compId)).toBe(false);
  });
});

describe('fichas — visibilidad', () => {
  it('la ficha de equipo no ofrece temporadas ocultas', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    const { homeTeamId } = await crearPartido({ seasonId });

    const visible = await get(teamDetailRouter, `/${homeTeamId}`);
    expect((visible.body as { seasons: Array<{ id: string }> }).seasons.some((s) => s.id === seasonId)).toBe(true);

    await setSeasonQualityDirect(seasonId, 'en_revision');

    const hidden = await get(teamDetailRouter, `/${homeTeamId}`);
    expect((hidden.body as { seasons: Array<{ id: string }> }).seasons.some((s) => s.id === seasonId)).toBe(false);
  });

  it('la ficha de jugador no expone carrera de temporadas ocultas', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    const { homeTeamId } = await crearPartido({ seasonId });
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO players (sport_id, first_name, last_name, slug)
       VALUES ($1, 'Test', 'Jugador', 'test-jugador-' || gen_random_uuid()::text) RETURNING id`,
      [sportId]
    );
    const playerId = rows[0]!.id;
    await db.query(
      `INSERT INTO team_players (season_id, team_id, player_id) VALUES ($1, $2, $3)`,
      [seasonId, homeTeamId, playerId]
    );

    const visible = await get(playerDetailRouter, `/${playerId}`);
    expect((visible.body as { career: { seasons: Array<{ seasonId: string }> } }).career.seasons.length).toBeGreaterThan(0);

    await setCompQualityDirect(compId, 'en_revision');

    const hidden = await get(playerDetailRouter, `/${playerId}`);
    expect((hidden.body as { career: { seasons: Array<{ seasonId: string }> } }).career.seasons.length).toBe(0);
  });
});

describe('GET /meta/sitemap — visibilidad', () => {
  it('excluye competiciones y partidos ocultos', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    const { matchId } = await crearPartido({ seasonId });

    const visible = await metaRouter.request('/sitemap');
    const vBody = await visible.json() as { competitions: Array<{ id: string }>; matches: Array<{ id: string }> };
    expect(vBody.competitions.some((c) => c.id === compId)).toBe(true);
    expect(vBody.matches.some((m) => m.id === matchId)).toBe(true);

    await setCompQualityDirect(compId, 'en_revision');

    const hidden = await metaRouter.request('/sitemap');
    const hBody = await hidden.json() as { competitions: Array<{ id: string }>; matches: Array<{ id: string }> };
    expect(hBody.competitions.some((c) => c.id === compId)).toBe(false);
    expect(hBody.matches.some((m) => m.id === matchId)).toBe(false);
  });
});
