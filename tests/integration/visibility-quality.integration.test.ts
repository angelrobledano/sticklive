/**
 * Visibilidad por calidad de datos (migración 067).
 *
 * Cubre las funciones de calidad de @sports/db (listados y marcado), el helper
 * `seasonVisible` y las vías HTTP de la API (listados, temporadas, partidos,
 * búsqueda, fichas de equipo/jugador y sitemap).
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  db, closeDb,
  listCompetitionsForQuality, setCompetitionQuality,
  listSeasonsForQuality, setSeasonQuality,
  upsertCompetition, upsertSeason,
} from '@sports/db';
import { seasonVisible } from '../../apps/api/src/lib/visibility.js';
import { competitionsRouter } from '../../apps/api/src/routes/competitions.js';
import { adminRouter } from '../../apps/api/src/routes/admin.js';
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
  crearPartido,
} from './support/factorias.js';

// El TTL de la micro-caché de /live se lee AL IMPORTAR `live.ts`, así que se
// fija a 0 ANTES del import dinámico para que el test sea determinista (sin
// esto, el segundo GET podría servir el valor cacheado del primero).
process.env['LIVE_CACHE_TTL_MS'] = '0';
const { liveRouter } = await import('../../apps/api/src/routes/live.js');

// Invoca un router de Hono y devuelve `{ status, body }` (body null si no es JSON).
async function get(router: { request: (p: string, init?: RequestInit) => Response | Promise<Response> }, path: string) {
  const res = await router.request(path);
  return { status: res.status, body: await res.json().catch(() => null) };
}

// Actualiza la calidad directamente en la BD para aislar cada ruta bajo prueba.
async function setCompQualityDirect(id: string, q: string) {
  await db.query(`UPDATE competitions SET data_quality = $2 WHERE id = $1`, [id, q]);
}
async function setSeasonQualityDirect(id: string, q: string) {
  await db.query(`UPDATE seasons SET data_quality = $2 WHERE id = $1`, [id, q]);
}

// El middleware de admin lee ADMIN_TOKEN en tiempo de request; lo fijamos antes
// de cualquier request (los guards de este fichero no dependen de la BD).
beforeAll(() => { process.env['ADMIN_TOKEN'] = 'test-token'; });

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

describe('GET /competitions — calendario de la temporada', () => {
  it('primer, último y próximo partido y cuántos hay en juego (las copas se destacan solas)', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    await crearPartido({ seasonId, status: 'finished', horasDesdeInicio: 48 });
    await crearPartido({ seasonId, status: 'live', horasDesdeInicio: 1 });
    await crearPartido({ seasonId, status: 'scheduled', horasDesdeInicio: -24 });
    await crearPartido({ seasonId, status: 'scheduled', horasDesdeInicio: -72 });

    const res = await get(competitionsRouter, '/');
    const body = res.body as { competitions: Array<{ id: string; season: Record<string, unknown> | null }> };
    const s = body.competitions.find((c) => c.id === compId)!.season!;
    const h = (iso: unknown) => (new Date(String(iso)).getTime() - Date.now()) / 3_600_000;
    expect(Math.round(h(s['firstMatchAt']))).toBe(-48);
    expect(Math.round(h(s['lastMatchAt']))).toBe(72);
    expect(Math.round(h(s['nextMatchAt']))).toBe(24);
    expect(s['liveMatches']).toBe(1);
  });

  it('liga: jornada en curso sobre el total; copa terminada: campeón de la final', async () => {
    const ronda = async (seasonId: string, number: number, type: string, stage: string | null = null) =>
      (await db.query<{ id: string }>(
        `INSERT INTO rounds (season_id, number, name, round_type, stage) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [seasonId, number, `R${number}`, type, stage])).rows[0]!.id;
    const asignar = (matchId: string, roundId: string, extra = '') =>
      db.query(`UPDATE matches SET round_id = $2 ${extra} WHERE id = $1`, [matchId, roundId]);

    // Liga a 3 jornadas: la 2 jugada, la 3 pendiente.
    const ligaId = await crearCompeticion(sportId);
    const liga = await crearTemporada(ligaId);
    for (const [n, st] of [[1, 'finished'], [2, 'finished'], [3, 'scheduled']] as const) {
      const r = await ronda(liga, n, 'regular');
      const { matchId } = await crearPartido({ seasonId: liga, status: st, horasDesdeInicio: st === 'finished' ? 24 * (4 - n) : -24 });
      await asignar(matchId, r);
    }

    // Copa: final terminada 2-2, gana el visitante por penaltis.
    const copaId = await crearCompeticion(sportId);
    const copa = await crearTemporada(copaId);
    const fin = await ronda(copa, 40, 'playoff', 'final');
    const p = await crearPartido({ seasonId: copa, status: 'finished', horasDesdeInicio: 24 });
    await asignar(p.matchId, fin, ', home_score = 2, away_score = 2, winner_team_id = away_team_id');

    const res = await get(competitionsRouter, '/');
    const body = res.body as { competitions: Array<{ id: string; season: Record<string, unknown> | null }> };
    const sLiga = body.competitions.find((c) => c.id === ligaId)!.season!;
    const sCopa = body.competitions.find((c) => c.id === copaId)!.season!;
    expect(sLiga['matchday']).toEqual({ current: 2, total: 3 });
    expect(sLiga['champion']).toBeNull();
    expect(sCopa['matchday']).toBeNull();
    expect(sCopa['champion']).toMatchObject({ teamId: p.awayTeamId });
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

  it('no devuelve una competición cuya única temporada con partidos está oculta', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    await crearPartido({ seasonId });
    const { rows } = await db.query<{ name: string }>(`SELECT name FROM competitions WHERE id = $1`, [compId]);
    const name = rows[0]!.name;

    await setSeasonQualityDirect(seasonId, 'en_revision');
    const hidden = await searchRouter.request(`/?q=${encodeURIComponent(name)}`);
    const body = await hidden.json() as { competitions: Array<{ id: string }> };
    expect(body.competitions.some((c) => c.id === compId)).toBe(false);
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

  it('la ficha de equipo no ofrece temporadas de una competición oculta', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    const { homeTeamId } = await crearPartido({ seasonId });

    await setCompQualityDirect(compId, 'en_revision');
    const hidden = await get(teamDetailRouter, `/${homeTeamId}`);
    expect((hidden.body as { seasons: Array<{ id: string }> }).seasons.some((s) => s.id === seasonId)).toBe(false);
  });

  it('la carrera de un jugador no incluye temporadas ocultas', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    const { homeTeamId } = await crearPartido({ seasonId });
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO players (sport_id, first_name, last_name, slug)
       VALUES ($1, 'Test', 'Jugador2', 'test-jugador2-' || gen_random_uuid()::text) RETURNING id`,
      [sportId]
    );
    const playerId = rows[0]!.id;
    await db.query(`INSERT INTO team_players (season_id, team_id, player_id) VALUES ($1, $2, $3)`, [seasonId, homeTeamId, playerId]);

    await setSeasonQualityDirect(seasonId, 'en_revision');
    const hidden = await get(playerDetailRouter, `/${playerId}`);
    expect((hidden.body as { career: { seasons: Array<{ seasonId: string }> } }).career.seasons.length).toBe(0);
  });

  it('las stats por competición no mezclan una temporada oculta con la misma fecha', async () => {
    const compId = await crearCompeticion(sportId);
    const sOk = await crearTemporada(compId);
    const sHidden = await crearTemporada(compId, { esActual: false });
    await db.query(`UPDATE seasons SET start_date = DATE '2020-01-01' WHERE id IN ($1, $2)`, [sOk, sHidden]);

    const mOk = await crearPartido({ seasonId: sOk });
    const mHidden = await crearPartido({ seasonId: sHidden });

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO players (sport_id, first_name, last_name, slug)
       VALUES ($1, 'Test', 'Stats', 'test-stats-' || gen_random_uuid()::text) RETURNING id`,
      [sportId]
    );
    const playerId = rows[0]!.id;
    await db.query(
      `INSERT INTO match_events (match_id, match_date, team_id, player_id, event_type)
       VALUES
         ($1, (SELECT scheduled_at::date FROM matches WHERE id = $1), $2, $3, 'goal'),
         ($4, (SELECT scheduled_at::date FROM matches WHERE id = $4), $5, $3, 'goal')`,
      [mOk.matchId, mOk.homeTeamId, playerId, mHidden.matchId, mHidden.homeTeamId]
    );

    await setSeasonQualityDirect(sHidden, 'en_revision');

    const res = await get(playerDetailRouter, `/${playerId}`);
    const body = res.body as { statsByCompetition: Array<{ competitionId: string; goals: number }> };
    const row = body.statsByCompetition.find((r) => r.competitionId === compId);
    expect(row?.goals).toBe(1); // solo el gol de la temporada visible
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

  it('excluye competición y partido cuando la temporada está oculta', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    const { matchId } = await crearPartido({ seasonId });

    await setSeasonQualityDirect(seasonId, 'en_revision');
    const res = await metaRouter.request('/sitemap');
    const body = await res.json() as { competitions: Array<{ id: string }>; matches: Array<{ id: string }> };
    expect(body.competitions.some((c) => c.id === compId)).toBe(false);
    expect(body.matches.some((m) => m.id === matchId)).toBe(false);
  });

  it('mantiene la competición si le queda alguna temporada visible con partidos', async () => {
    const compId = await crearCompeticion(sportId);
    const sVisible = await crearTemporada(compId);
    const sHidden = await crearTemporada(compId, { esActual: false });
    await crearPartido({ seasonId: sVisible });
    await crearPartido({ seasonId: sHidden });

    await setSeasonQualityDirect(sHidden, 'en_revision');
    const res = await metaRouter.request('/sitemap');
    const body = await res.json() as { competitions: Array<{ id: string }> };
    expect(body.competitions.some((c) => c.id === compId)).toBe(true);
  });
});

describe('admin — calidad end-to-end', () => {
  // Token fijo: `beforeAll` fija ADMIN_TOKEN, pero este `const` se evalúa al
  // recolectar los tests (antes del hook), así que no dependemos del orden.
  const AUTH = { 'x-admin-token': 'test-token' };
  const JSON_AUTH = { ...AUTH, 'content-type': 'application/json' };

  it('PATCH quality oculta y desoculta', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    await crearPartido({ seasonId });

    const hide = await adminRouter.request(`/seasons/${seasonId}/quality`, {
      method: 'PATCH', headers: JSON_AUTH, body: JSON.stringify({ dataQuality: 'en_revision' }),
    });
    expect(hide.status).toBe(200);
    expect((await get(seasonOverviewRouter, `/${seasonId}/overview`)).status).toBe(404);

    const show = await adminRouter.request(`/seasons/${seasonId}/quality`, {
      method: 'PATCH', headers: JSON_AUTH, body: JSON.stringify({ dataQuality: 'ok' }),
    });
    expect(show.status).toBe(200);
    expect((await get(seasonOverviewRouter, `/${seasonId}/overview`)).status).toBe(200);

    const list = await adminRouter.request('/competitions/quality', { headers: AUTH });
    expect(list.status).toBe(200);
    const listBody = await list.json() as { competitions: Array<{ id: string; season_count: string; visible_season_count: string }> };
    const row = listBody.competitions.find((c) => c.id === compId);
    expect(row).toBeDefined();
    expect(Number(row!.season_count)).toBe(1);
    expect(Number(row!.visible_season_count)).toBe(1);
  });
});

describe('la curación sobrevive a los upserts', () => {
  it('upsertCompetition y upsertSeason no resetean data_quality', async () => {
    const compId = await crearCompeticion(sportId);
    const seasonId = await crearTemporada(compId);
    await db.query(`UPDATE competitions SET data_quality = 'en_revision' WHERE id = $1`, [compId]);
    await db.query(`UPDATE seasons SET data_quality = 'en_revision' WHERE id = $1`, [seasonId]);

    const compSlug = (await db.query<{ slug: string }>(`SELECT slug FROM competitions WHERE id = $1`, [compId])).rows[0]!.slug;
    const updatedComp = await upsertCompetition({ sportId, name: 'Renombrada', slug: compSlug, country: 'ES' });
    expect(updatedComp.data_quality).toBe('en_revision');

    const seasonSlug = (await db.query<{ slug: string }>(`SELECT slug FROM seasons WHERE id = $1`, [seasonId])).rows[0]!.slug;
    const updatedSeason = await upsertSeason({ competitionId: compId, name: 'Renombrada', slug: seasonSlug });
    expect(updatedSeason.data_quality).toBe('en_revision');
  });
});
