/**
 * A2 — separar jugadores fusionados por colisión de ids entre portales.
 *
 * Caso real (producción, 22/10/2026): `fep_player_4716` es Pol Galbas en RFEP
 * (OK Liga) y un jugador italiano sub-19 en World Skate. Tras la 081 ese
 * jugador sigue con `fep_player_4716` y apariciones en dos portales. El script
 * crea la persona de World Skate (`wse_player_4716`) y le mueve plantillas,
 * alineaciones y eventos de los partidos de su portal.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearDeporte, crearTemporada, crearEquipo } from './support/factorias.js';
import { splitMergedPlayers } from '../../apps/etl/src/split-merged-players.js';

beforeEach(limpiar);
afterAll(closeDb);

async function escenario() {
  const sportId = await crearDeporte();
  const [caldes, italia] = [await crearEquipo(sportId, 'CALDES'), await crearEquipo(sportId, 'Italia')];
  const comp = async (org: string, ref: string) => (await db.query<{ id: string }>(
    `INSERT INTO competitions (sport_id, name, slug, organizer, source_ref) VALUES ($1,$2,$2,$3,$4) RETURNING id`,
    [sportId, `c-${ref}`, org, ref])).rows[0]!.id;
  const rfep = await crearTemporada(await comp('RFEP', '3150'));
  const ws = await crearTemporada(await comp('World Skate', 'wse_competition_320'));
  const player = (await db.query<{ id: string }>(
    `INSERT INTO players (sport_id, first_name, last_name, slug, source_ref, photo_url)
     VALUES ($1,'POL','GALBAS PEDROL','galbas-pedrol-pol','fep_player_4716','https://x/4716.jpg') RETURNING id`,
    [sportId])).rows[0]!.id;

  const partido = async (season: string, ref: string, home: string) => (await db.query<{ id: string; scheduled_at: Date }>(
    `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at, source_ref)
     VALUES ($1,$2,$3,'finished','2026-10-01T18:00:00Z',$4) RETURNING id, scheduled_at`,
    [season, home, home === caldes ? italia : caldes, ref])).rows[0]!;
  const mR = await partido(rfep, 'fep_match_1', caldes);
  const mW = await partido(ws, 'wse_match_2', italia);

  await db.query(`INSERT INTO team_players (season_id, team_id, player_id) VALUES ($1,$2,$3),($4,$5,$3)`, [rfep, caldes, player, ws, italia]);
  await db.query(
    `INSERT INTO match_lineups (match_id, is_home, player_name, player_id, player_source_ref) VALUES
       ($1, TRUE, 'GALBAS PEDROL POL', $3, 'fep_player_4716'),
       ($2, TRUE, 'TOGNETTI ANDREA BRUNO', $3, 'wse_player_4716')`,
    [mR.id, mW.id, player]);
  await db.query(
    `INSERT INTO match_events (match_id, match_date, team_id, player_id, event_type, source_ref)
     VALUES ($1, $2::date, $3, $4, 'goal', 'fep_event_1_a'), ($5, $6::date, $7, $4, 'goal', 'wse_event_2_a')`,
    [mR.id, mR.scheduled_at, caldes, player, mW.id, mW.scheduled_at, italia]);
  return { player, mR: mR.id, mW: mW.id, italia, ws };
}

describe('A2 — splitMergedPlayers', () => {
  it('en dry-run informa y no escribe', async () => {
    const e = await escenario();
    const r = await splitMergedPlayers({ write: false });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ playerId: e.player, keep: 'fep', split: ['wse'] });
    const n = await db.query(`SELECT count(*)::int AS n FROM players`);
    expect(n.rows[0]!.n).toBe(1);
  });

  it('con write crea la persona del otro portal y le mueve sus datos', async () => {
    const e = await escenario();
    await splitMergedPlayers({ write: true });

    const nuevo = (await db.query<{ id: string; first_name: string; last_name: string; photo_url: string | null }>(
      `SELECT id, first_name, last_name, photo_url FROM players WHERE source_ref = 'wse_player_4716'`)).rows[0]!;
    expect(nuevo).toMatchObject({ first_name: 'BRUNO', last_name: 'TOGNETTI ANDREA', photo_url: null });

    const tp = await db.query(`SELECT player_id FROM team_players WHERE season_id = $1`, [e.ws]);
    expect(tp.rows).toEqual([{ player_id: nuevo.id }]);
    const ml = await db.query(`SELECT player_id FROM match_lineups WHERE match_id = $1`, [e.mW]);
    expect(ml.rows).toEqual([{ player_id: nuevo.id }]);
    const ev = await db.query(`SELECT player_id FROM match_events WHERE match_id = $1`, [e.mW]);
    expect(ev.rows).toEqual([{ player_id: nuevo.id }]);

    // La persona RFEP se queda con lo suyo y su ref.
    const viejo = await db.query(`SELECT source_ref FROM players WHERE id = $1`, [e.player]);
    expect(viejo.rows[0]).toEqual({ source_ref: 'fep_player_4716' });
    const evR = await db.query(`SELECT player_id FROM match_events WHERE match_id = $1`, [e.mR]);
    expect(evR.rows).toEqual([{ player_id: e.player }]);
  });

  it('es idempotente: una segunda pasada no encuentra nada', async () => {
    await escenario();
    await splitMergedPlayers({ write: true });
    const r = await splitMergedPlayers({ write: true });
    expect(r.candidates).toHaveLength(0);
  });
});
