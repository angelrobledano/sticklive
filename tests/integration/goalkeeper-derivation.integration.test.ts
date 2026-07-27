/**
 * Migración 039 + derivación de "portero" desde las alineaciones.
 *
 * `players.position` era una columna muerta (siempre NULL): el ORDER BY
 * "porteros primero" de team-detail y la sección de porteros de la web no
 * hacían nada. La 039 la elimina y la condición de portero pasa a derivarse de
 * `match_lineups.is_goalkeeper`, que es la única señal real.
 *
 * Este test fija esa derivación —el `EXISTS` que usan team-detail y
 * player-detail— contra datos reales, además de comprobar que la columna
 * desaparece.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearPartido, type EscenarioPartido } from './support/factorias.js';

let esc: EscenarioPartido;

/** Crea un jugador y lo alinea en el partido, marcándolo o no como portero. */
async function alinear(nombre: string, esPortero: boolean): Promise<string> {
  const slug = `pl-${Math.random().toString(36).slice(2)}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO players (sport_id, first_name, last_name, slug)
     VALUES ($1, $2, '', $3) RETURNING id`,
    [esc.sportId, nombre, slug]
  );
  const playerId = rows[0]!.id;
  await db.query(
    `INSERT INTO match_lineups (match_id, team_id, is_home, player_name, player_id, is_goalkeeper, is_starter)
     VALUES ($1, $2, TRUE, $3, $4, $5, TRUE)`,
    [esc.matchId, esc.homeTeamId, nombre, playerId, esPortero]
  );
  return playerId;
}

/** El EXISTS que usa la API (team-detail / player-detail). */
async function esPorteroDerivado(playerId: string): Promise<boolean> {
  const { rows } = await db.query<{ gk: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM match_lineups ml
       WHERE ml.player_id = $1 AND ml.is_goalkeeper = TRUE
     ) AS gk`,
    [playerId]
  );
  return rows[0]!.gk;
}

beforeAll(async () => {
  await limpiar();
  esc = await crearPartido({ status: 'finished' });
});

beforeEach(async () => {
  // Todas las alineaciones (algún test crea un segundo partido) antes que los
  // jugadores, o la FK match_lineups.player_id bloquea el borrado.
  await db.query('DELETE FROM match_lineups');
  await db.query('DELETE FROM players');
});

afterAll(async () => {
  await closeDb();
});

describe('migración 039 — drop players.position', () => {
  it('la columna players.position ya no existe', async () => {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'players' AND column_name = 'position'`
    );
    expect(rows).toHaveLength(0);
  });
});

describe('derivación de portero desde match_lineups', () => {
  it('un jugador alineado como portero se deriva como tal', async () => {
    const gk = await alinear('Cándido', true);
    expect(await esPorteroDerivado(gk)).toBe(true);
  });

  it('un jugador de pista NO se deriva como portero', async () => {
    const outfield = await alinear('Ferran', false);
    expect(await esPorteroDerivado(outfield)).toBe(false);
  });

  it('basta con que sea portero en UNA alineación de las suyas', async () => {
    // Portero que otro día jugó de campo (en OTRO partido): sigue contando.
    const gk = await alinear('Portero', true);
    // Segundo partido de la misma temporada, donde va de jugador de campo.
    const otro = (await db.query<{ id: string }>(
      `INSERT INTO matches (season_id, home_team_id, away_team_id, status, source_ref)
       VALUES ($1, $2, $3, 'finished', $4) RETURNING id`,
      [esc.seasonId, esc.homeTeamId, esc.awayTeamId, `m-${Math.random().toString(36).slice(2)}`]
    )).rows[0]!.id;
    await db.query(
      `INSERT INTO match_lineups (match_id, team_id, is_home, player_name, player_id, is_goalkeeper, is_starter)
       VALUES ($1, $2, TRUE, 'Portero', $3, FALSE, TRUE)`,
      [otro, esc.homeTeamId, gk]
    );
    expect(await esPorteroDerivado(gk)).toBe(true);
  });

  it('un jugador sin alineaciones no es portero', async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO players (sport_id, first_name, last_name, slug)
       VALUES ($1, 'Sin', 'Actas', $2) RETURNING id`,
      [esc.sportId, `pl-${Math.random().toString(36).slice(2)}`]
    );
    expect(await esPorteroDerivado(rows[0]!.id)).toBe(false);
  });
});
