/**
 * deriveMatchResults — desglose del resultado (reglamentario/prórroga/penaltis,
 * ganador) a partir de los eventos. Data-correctness de los partidos finalizados.
 *
 * Los partidos se INSERTAN directamente (no por UPDATE) para controlar
 * updated_at: matches tiene un trigger BEFORE UPDATE que lo forzaría a NOW().
 * Los eventos se cargan por replaceMatchEvents (el camino real), que fija
 * match_date y la partición de match_events (migración 047).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, replaceMatchEvents, type UpsertMatchEventInput } from '@sports/db';
import { deriveMatchResults } from '../../apps/etl/src/derive-results.js';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada, crearEquipo } from './support/factorias.js';

let seq = 0;
const ref = () => `fep_dr_${++seq}`;

async function escenario() {
  const sportId = await crearDeporte();
  const competitionId = await crearCompeticion(sportId);
  const seasonId = await crearTemporada(competitionId);
  const home = await crearEquipo(sportId);
  const away = await crearEquipo(sportId);
  return { seasonId, home, away };
}

async function partido(e: { seasonId: string; home: string; away: string }, o: {
  hs: number; as: number; winner?: string | null; winType?: string | null; updatedHoursAgo?: number;
}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at,
                          home_score, away_score, winner_team_id, win_type, updated_at, source_ref)
     VALUES ($1,$2,$3,'finished', NOW() - INTERVAL '1 hour', $4,$5,$6,$7,
             NOW() - make_interval(hours => $8::int), $9) RETURNING id`,
    [e.seasonId, e.home, e.away, o.hs, o.as, o.winner ?? null, o.winType ?? null, o.updatedHoursAgo ?? 0, ref()]
  );
  return rows[0]!.id;
}

const gol = (teamId: string, period: number, minute = 5): UpsertMatchEventInput =>
  ({ teamId, playerId: null, eventType: 'goal', minute, period, detail: null, sourceRef: ref() });
const finPeriodo = (period: number): UpsertMatchEventInput =>
  ({ teamId: null, playerId: null, eventType: 'period_end', minute: null, period, detail: null, sourceRef: ref() });

async function leer(matchId: string) {
  const { rows } = await db.query<{
    win_type: string | null; winner_team_id: string | null;
    home_goals_reg: number | null; away_goals_reg: number | null;
  }>(`SELECT win_type, winner_team_id, home_goals_reg, away_goals_reg FROM matches WHERE id = $1`, [matchId]);
  return rows[0]!;
}

beforeEach(async () => { await limpiar(); seq = 0; });
afterAll(async () => { await closeDb(); });

describe('deriveMatchResults', () => {
  it('T-036: win_type=overtime cuando hay gol en periodo ≥3', async () => {
    const e = await escenario();
    const m = await partido(e, { hs: 3, as: 2 });
    await replaceMatchEvents(m, [
      gol(e.home, 1), gol(e.home, 2), gol(e.away, 1), gol(e.away, 2), gol(e.home, 3),
    ]);
    await deriveMatchResults([e.seasonId]);
    const r = await leer(m);
    expect(r.win_type).toBe('overtime');
    expect(r.winner_team_id).toBe(e.home);
  });

  it('T-037: win_type=penalties con empate + fase extra sin goles de OT', async () => {
    const e = await escenario();
    const m = await partido(e, { hs: 3, as: 3 });
    await replaceMatchEvents(m, [
      gol(e.home, 1), gol(e.home, 2), gol(e.home, 2),
      gol(e.away, 1), gol(e.away, 2), gol(e.away, 2), finPeriodo(3),
    ]);
    await deriveMatchResults([e.seasonId]);
    expect((await leer(m)).win_type).toBe('penalties');
  });

  it('T-038: win_type=regular decidido en tiempo reglamentario', async () => {
    const e = await escenario();
    const m = await partido(e, { hs: 2, as: 1 });
    await replaceMatchEvents(m, [gol(e.home, 1), gol(e.home, 2), gol(e.away, 2)]);
    await deriveMatchResults([e.seasonId]);
    const r = await leer(m);
    expect(r.win_type).toBe('regular');
    expect(r.winner_team_id).toBe(e.home);
  });

  it('T-039: en penaltis CONSERVA el ganador que puso el acta (no lo pisa por marcador)', async () => {
    const e = await escenario();
    const m = await partido(e, { hs: 2, as: 2, winner: e.away });
    await replaceMatchEvents(m, [gol(e.home, 1), gol(e.home, 2), gol(e.away, 1), gol(e.away, 2), finPeriodo(3)]);
    await deriveMatchResults([e.seasonId]);
    const r = await leer(m);
    expect(r.win_type).toBe('penalties');
    expect(r.winner_team_id).toBe(e.away);
  });

  it('T-040: home/away_goals_reg cuentan solo periodo ≤2', async () => {
    const e = await escenario();
    const m = await partido(e, { hs: 3, as: 1 });
    await replaceMatchEvents(m, [gol(e.home, 1), gol(e.home, 2), gol(e.home, 3), gol(e.away, 1)]);
    await deriveMatchResults([e.seasonId]);
    const r = await leer(m);
    expect(Number(r.home_goals_reg)).toBe(2);
    expect(Number(r.away_goals_reg)).toBe(1);
  });

  it('T-041: no recalcula partidos con updated_at anterior a 12 h', async () => {
    const e = await escenario();
    const m = await partido(e, { hs: 3, as: 2, updatedHoursAgo: 13 });
    await replaceMatchEvents(m, [gol(e.home, 3)]);
    await deriveMatchResults([e.seasonId]);
    expect((await leer(m)).win_type).toBeNull();
  });
});
