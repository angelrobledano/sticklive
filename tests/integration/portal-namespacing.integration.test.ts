/**
 * A1 — espacio de nombres por portal para lo YA cargado (migración 081).
 *
 * Hasta ahora todas las actas sidgad producían `fep_player_{id}` y FECAPA se
 * cargó con `fep_match_` y un idc sin prefijo. `apply_portal_namespacing()`
 * renombra lo que pertenece de forma inequívoca a UN portal distinto de RFEP y
 * deja intactos a los jugadores que aparecen en varios portales: esos son las
 * fusiones de personas distintas que separa el script de A2.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearTemporada, crearEquipo } from './support/factorias.js';

beforeEach(limpiar);
afterAll(closeDb);

let n = 0;
async function competicion(sportId: string, organizer: string, sourceRef: string): Promise<string> {
  n += 1;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO competitions (sport_id, name, slug, organizer, source_ref) VALUES ($1,$2,$2,$3,$4) RETURNING id`,
    [sportId, `comp-${n}`, organizer, sourceRef],
  );
  return rows[0]!.id;
}

async function jugador(sportId: string, ref: string): Promise<string> {
  n += 1;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO players (sport_id, first_name, last_name, slug, source_ref) VALUES ($1,'X',$2,$2,$3) RETURNING id`,
    [sportId, `j-${n}`, ref],
  );
  return rows[0]!.id;
}

async function partidoCon(seasonId: string, home: string, away: string, ref: string, playerId: string, playerRef: string) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, source_ref)
     VALUES ($1,$2,$3,'finished',NOW(),$4) RETURNING id`,
    [seasonId, home, away, ref],
  );
  const matchId = rows[0]!.id;
  await db.query(`INSERT INTO team_players (season_id, team_id, player_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [seasonId, home, playerId]);
  await db.query(
    `INSERT INTO match_lineups (match_id, is_home, player_name, player_id, player_source_ref, source_ref)
     VALUES ($1, TRUE, 'X', $2, $3, $4)`,
    [matchId, playerId, playerRef, `lineup-${matchId}`],
  );
  return matchId;
}

async function escenario() {
  const sportId = await crearDeporte();
  const [a, b] = [await crearEquipo(sportId, 'A'), await crearEquipo(sportId, 'B')];
  const rfep = await crearTemporada(await competicion(sportId, 'RFEP', '3150'));
  const fecapa = await crearTemporada(await competicion(sportId, 'FECAPA', '4858'));
  const ws = await crearTemporada(await competicion(sportId, 'World Skate', 'wse_competition_320'));

  const soloRfep = await jugador(sportId, 'fep_player_4095');
  const soloFecapa = await jugador(sportId, 'fep_player_14782');
  const soloWs = await jugador(sportId, 'fep_player_192');
  const fusionado = await jugador(sportId, 'fep_player_4716');

  await partidoCon(rfep, a, b, 'fep_match_1', soloRfep, 'fep_player_4095');
  await partidoCon(fecapa, a, b, 'fep_match_164291', soloFecapa, 'fep_player_14782');
  await partidoCon(ws, a, b, 'wse_match_3', soloWs, 'fep_player_192');
  await partidoCon(rfep, b, a, 'fep_match_2', fusionado, 'fep_player_4716');
  await partidoCon(ws, b, a, 'wse_match_4', fusionado, 'fep_player_4716');
  return { soloRfep, soloFecapa, soloWs, fusionado };
}

const refDe = async (id: string) =>
  (await db.query<{ source_ref: string }>(`SELECT source_ref FROM players WHERE id = $1`, [id])).rows[0]!.source_ref;

describe('081 — apply_portal_namespacing()', () => {
  it('renombra jugadores, partidos, alineaciones y competición de un solo portal', async () => {
    const j = await escenario();
    await db.query(`SELECT * FROM apply_portal_namespacing()`);

    expect(await refDe(j.soloRfep)).toBe('fep_player_4095');
    expect(await refDe(j.soloFecapa)).toBe('fecapa_player_14782');
    expect(await refDe(j.soloWs)).toBe('wse_player_192');

    const partidos = await db.query<{ source_ref: string }>(`SELECT source_ref FROM matches ORDER BY source_ref`);
    expect(partidos.rows.map((r) => r.source_ref)).toEqual(
      ['fecapa_match_164291', 'fep_match_1', 'fep_match_2', 'wse_match_3', 'wse_match_4'],
    );
    const comps = await db.query<{ source_ref: string }>(`SELECT source_ref FROM competitions ORDER BY source_ref`);
    expect(comps.rows.map((r) => r.source_ref)).toEqual(['3150', 'fecapa_competition_4858', 'wse_competition_320']);

    const alineaciones = await db.query<{ player_source_ref: string }>(
      `SELECT player_source_ref FROM match_lineups ORDER BY player_source_ref`,
    );
    // Las alineaciones se renombran por el portal del PARTIDO, también las
    // del jugador fusionado: la ref del acta es inequívoca aunque la fila no.
    expect(alineaciones.rows.map((r) => r.player_source_ref)).toEqual(
      ['fecapa_player_14782', 'fep_player_4095', 'fep_player_4716', 'wse_player_192', 'wse_player_4716'],
    );
  });

  it('no toca a los jugadores con apariciones en varios portales (los separa A2)', async () => {
    const j = await escenario();
    const { rows } = await db.query<{ players_mixed: number }>(`SELECT * FROM apply_portal_namespacing()`);
    expect(await refDe(j.fusionado)).toBe('fep_player_4716');
    expect(rows[0]!.players_mixed).toBe(1);
  });

  it('es idempotente', async () => {
    await escenario();
    await db.query(`SELECT * FROM apply_portal_namespacing()`);
    const { rows } = await db.query<{ players_renamed: number; matches_renamed: number; competitions_renamed: number }>(
      `SELECT * FROM apply_portal_namespacing()`,
    );
    expect(rows[0]).toMatchObject({ players_renamed: 0, matches_renamed: 0, competitions_renamed: 0 });
  });
});
