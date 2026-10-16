/**
 * Ficha de jugador que JUGÓ pero no marcó.
 *
 * `statsByCompetition` se construía desde `match_events`, así que un jugador
 * con alineaciones y sin eventos (ni gol, ni tarjeta, ni penalti) no tenía
 * ninguna fila: la web mostraba "Sin estadísticas en la temporada actual" y su
 * ficha quedaba vacía. En producción son 345 de los 1.667 jugadores del sitemap
 * (~21%): para Google, páginas finas; para el usuario, una ficha sin su
 * partido jugado.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { playerDetailRouter } from '../../apps/api/src/routes/player-detail.js';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada, crearPartido } from './support/factorias.js';

interface PlayerResponse {
  seasonTotals: { pj: number; goals: number; assists: number };
  statsByCompetition: Array<{ competitionId: string; pj: number; goals: number }>;
  career: { seasons: Array<{ seasonId: string }> };
}

async function get(path: string) {
  const res = await playerDetailRouter.request(path);
  return { status: res.status, body: (await res.json().catch(() => null)) as PlayerResponse | null };
}

/** Jugador con alineación pero SIN ningún evento (ni gol ni tarjetas). */
async function jugadorQueJugoSinEventos() {
  const sportId = await crearDeporte();
  const seasonId = await crearTemporada(await crearCompeticion(sportId));
  const { homeTeamId, matchId } = await crearPartido({ seasonId });

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO players (sport_id, first_name, last_name, slug)
     VALUES ($1, 'Sin', 'Eventos', 'sin-eventos-' || gen_random_uuid()::text) RETURNING id`,
    [sportId]
  );
  const playerId = rows[0]!.id;

  await db.query(
    `INSERT INTO team_players (season_id, team_id, player_id) VALUES ($1, $2, $3)`,
    [seasonId, homeTeamId, playerId]
  );
  await db.query(
    `INSERT INTO match_lineups (match_id, team_id, is_home, player_name, player_id, goals)
     VALUES ($1, $2, TRUE, 'Sin Eventos', $3, 0)`,
    [matchId, homeTeamId, playerId]
  );

  return { playerId, matchId, seasonId, homeTeamId };
}

beforeEach(limpiar);
afterAll(closeDb);

describe('ficha de jugador con alineación y sin eventos', () => {
  it('devuelve el partido jugado (antes: stats vacías)', async () => {
    const { playerId } = await jugadorQueJugoSinEventos();

    const { status, body } = await get(`/${playerId}`);

    expect(status).toBe(200);
    expect(body!.statsByCompetition).toHaveLength(1);
    expect(body!.statsByCompetition[0]).toMatchObject({ pj: 1, goals: 0 });
    // `seasonTotals.pj` es lo que decide si la web pinta la tabla o el
    // "sin estadísticas" (StatsGrid → hasAnyData).
    expect(body!.seasonTotals.pj).toBe(1);
  });

  it('con un gol sigue contando partido y gol (sin regresión)', async () => {
    const { playerId, matchId, homeTeamId } = await jugadorQueJugoSinEventos();
    await db.query(
      `INSERT INTO match_events (match_id, team_id, player_id, event_type, minute, period)
       VALUES ($1, $2, $3, 'goal', 5, 1)`,
      [matchId, homeTeamId, playerId]
    );

    const { body } = await get(`/${playerId}`);

    expect(body!.statsByCompetition).toHaveLength(1);
    expect(body!.statsByCompetition[0]).toMatchObject({ pj: 1, goals: 1 });
    expect(body!.seasonTotals).toMatchObject({ pj: 1, goals: 1 });
  });
});
