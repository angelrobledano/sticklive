/**
 * Qué entra en el sitemap (F1-3 y F1-4 de docs/AUDITORIA_SEO_2026-10-16.md).
 *
 * El sitemap publicaba 15.115 URLs: todos los equipos (62 sin un solo partido ni
 * plantilla), 1.667 jugadores de cualquier categoría y partidos a meses vista.
 * Decisión de producto (17/10/2026): se indexan jugadores de las competiciones
 * más importantes (`competitions.top_tier`). El resto de fichas sigue
 * accesible, solo deja de declararse en el sitemap.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { metaRouter } from '../../apps/api/src/routes/meta.js';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada, crearEquipo, crearPartido } from './support/factorias.js';

interface SitemapBody {
  competitions: Array<{ id: string }>;
  teams: Array<{ id: string }>;
  players: Array<{ id: string }>;
  matches: Array<{ id: string }>;
}

async function sitemap(): Promise<SitemapBody> {
  const res = await metaRouter.request('/sitemap');
  expect(res.status).toBe(200);
  return (await res.json()) as SitemapBody;
}

const ids = (list: Array<{ id: string }>) => list.map((x) => x.id);

async function jugadorEn(matchId: string, teamId: string, sportId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO players (sport_id, first_name, last_name, slug)
     VALUES ($1, 'Nombre', 'Apellido', 'jugador-' || gen_random_uuid()::text) RETURNING id`,
    [sportId]
  );
  const playerId = rows[0]!.id;
  await db.query(
    `INSERT INTO match_lineups (match_id, team_id, is_home, player_name, player_id, goals)
     VALUES ($1, $2, TRUE, 'Jugador ' || $3::text, $3::uuid, 0)`,
    [matchId, teamId, playerId]
  );
  return playerId;
}

/**
 * Umbrales vigentes (b1f008c, 19/10/2026, "para reducir volumen"): un equipo
 * entra con 3 partidos en temporadas visibles y un jugador con 8 alineaciones
 * en competiciones top_tier. Una ficha con menos es una ficha casi vacía.
 */
async function masPartidos(base: { seasonId: string; homeTeamId: string; awayTeamId: string }, n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, source_ref)
       VALUES ($1, $2, $3, 'finished', NOW() - INTERVAL '2 days', 'extra-' || gen_random_uuid()::text) RETURNING id`,
      [base.seasonId, base.homeTeamId, base.awayTeamId],
    );
    out.push(rows[0]!.id);
  }
  return out;
}

async function alinear(playerId: string, matchIds: string[], teamId: string) {
  for (const m of matchIds) {
    await db.query(
      `INSERT INTO match_lineups (match_id, team_id, is_home, player_name, player_id, goals)
       VALUES ($1, $2, TRUE, 'Jugador ' || $3::text, $3::uuid, 0)`,
      [m, teamId, playerId],
    );
  }
}

beforeEach(limpiar);
afterAll(closeDb);

describe('GET /meta/sitemap — jugadores', () => {
  it('solo jugadores con al menos 8 alineaciones en una competición top_tier', async () => {
    const top = await crearPartido({ status: 'finished', horasDesdeInicio: 48 });
    await db.query(`UPDATE competitions SET top_tier = TRUE WHERE id = $1`, [top.competitionId]);
    const extra = await masPartidos(top, 7);
    const bajo = await crearPartido({ status: 'finished', horasDesdeInicio: 48 });
    const extraBajo = await masPartidos(bajo, 7);

    const enTop = await jugadorEn(top.matchId, top.homeTeamId, top.sportId);
    await alinear(enTop, extra, top.homeTeamId);                         // 8 alineaciones
    const pocoTop = await jugadorEn(top.matchId, top.homeTeamId, top.sportId);
    await alinear(pocoTop, extra.slice(1), top.homeTeamId);              // 7 alineaciones
    const enBajo = await jugadorEn(bajo.matchId, bajo.homeTeamId, bajo.sportId);
    await alinear(enBajo, extraBajo, bajo.homeTeamId);                   // 8, pero no top_tier

    const body = await sitemap();
    expect(ids(body.players)).toContain(enTop);
    expect(ids(body.players)).not.toContain(pocoTop);
    expect(ids(body.players)).not.toContain(enBajo);
  });

  it('un jugador top_tier en una temporada oculta no entra', async () => {
    const top = await crearPartido({ status: 'finished', horasDesdeInicio: 48 });
    await db.query(`UPDATE competitions SET top_tier = TRUE WHERE id = $1`, [top.competitionId]);
    await db.query(`UPDATE seasons SET data_quality = 'en_revision' WHERE id = $1`, [top.seasonId]);
    const playerId = await jugadorEn(top.matchId, top.homeTeamId, top.sportId);

    expect(ids((await sitemap()).players)).not.toContain(playerId);
  });
});

describe('GET /meta/sitemap — equipos', () => {
  it('solo equipos con al menos 3 partidos en temporadas visibles', async () => {
    const tres = await crearPartido();
    await masPartidos(tres, 2);
    const dos = await crearPartido();
    await masPartidos(dos, 1);
    const sinPartidos = await crearEquipo(tres.sportId);

    const body = await sitemap();
    expect(ids(body.teams)).toEqual(expect.arrayContaining([tres.homeTeamId, tres.awayTeamId]));
    expect(ids(body.teams)).not.toContain(dos.homeTeamId);
    expect(ids(body.teams)).not.toContain(sinPartidos);
  });

  it('un equipo cuyos únicos partidos están en una temporada oculta no entra', async () => {
    const { homeTeamId, seasonId } = await crearPartido();
    await db.query(`UPDATE seasons SET data_quality = 'en_revision' WHERE id = $1`, [seasonId]);
    expect(ids((await sitemap()).teams)).not.toContain(homeTeamId);
  });
});

describe('GET /meta/sitemap — partidos', () => {
  it('ventana: jugados en los últimos 60 días y próximos 14 días', async () => {
    const sportId = await crearDeporte();
    const seasonId = await crearTemporada(await crearCompeticion(sportId));
    const reciente = (await crearPartido({ seasonId, status: 'finished', horasDesdeInicio: 24 * 10 })).matchId;
    const viejo = (await crearPartido({ seasonId, status: 'finished', horasDesdeInicio: 24 * 90 })).matchId;
    const proximo = (await crearPartido({ seasonId, horasDesdeInicio: -24 * 7 })).matchId;
    const lejano = (await crearPartido({ seasonId, horasDesdeInicio: -24 * 60 })).matchId;

    const body = ids((await sitemap()).matches);
    expect(body).toEqual(expect.arrayContaining([reciente, proximo]));
    expect(body).not.toContain(viejo);
    expect(body).not.toContain(lejano);
  });
});

describe('competitions.top_tier (migración 074)', () => {
  it('marca las competiciones de máxima categoría por slug', async () => {
    const { rows } = await db.query<{ column_default: string }>(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name = 'competitions' AND column_name = 'top_tier'`
    );
    expect(rows[0]?.column_default).toBe('false');
  });
});
