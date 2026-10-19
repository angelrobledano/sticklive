/**
 * selectFichaCandidates — qué actas vuelve a pedir el directo.
 *
 * Caso real (Mundial, ITA–CHI 1-1 del 16/10/2026): el acta se capturó con la
 * tanda de penaltis a medias (1-1) y, como los goles del acta ya cuadraban con
 * el marcador, nadie la volvió a pedir. Una tanda empatada nunca es un final:
 * hay que seguir pidiendo el acta hasta que se decida.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, replaceMatchEvents, type UpsertMatchEventInput } from '@sports/db';
import { selectFichaCandidates } from '../../apps/etl/src/ficha-candidates.js';
import { limpiar } from './support/db.js';
import { crearDeporte, crearCompeticion, crearTemporada, crearEquipo } from './support/factorias.js';

let seq = 0;
const ref = () => `wse_match_${9000 + ++seq}`;

async function escenario() {
  const sportId = await crearDeporte();
  const competitionId = await crearCompeticion(sportId, 'wse_competition_325');
  const seasonId = await crearTemporada(competitionId);
  const home = await crearEquipo(sportId);
  const away = await crearEquipo(sportId);
  return { seasonId, home, away };
}

/** Partido terminado hace 1 h con marcador, tanda opcional y goles en el acta que cuadran. */
async function terminado(e: { seasonId: string; home: string; away: string }, o: {
  hs: number; as: number; hp?: number | null; ap?: number | null;
}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO matches (season_id, home_team_id, away_team_id, status, scheduled_at,
                          home_score, away_score, home_pen, away_pen, source_ref)
     VALUES ($1,$2,$3,'finished', NOW() - INTERVAL '3 hours', $4,$5,$6,$7,$8) RETURNING id`,
    [e.seasonId, e.home, e.away, o.hs, o.as, o.hp ?? null, o.ap ?? null, ref()]
  );
  const id = rows[0]!.id;
  const gol = (teamId: string): UpsertMatchEventInput =>
    ({ teamId, playerId: null, eventType: 'goal', minute: 5, period: 1, detail: null, sourceRef: `ev_${++seq}` });
  await replaceMatchEvents(id, [
    ...Array.from({ length: o.hs }, () => gol(e.home)),
    ...Array.from({ length: o.as }, () => gol(e.away)),
  ]);
  return id;
}

const ids = async (seasonId: string) => (await selectFichaCandidates([seasonId])).map((r) => r.id);

beforeEach(async () => { await limpiar(); seq = 0; });
afterAll(async () => { await closeDb(); });

describe('selectFichaCandidates', () => {
  it('T-047: tanda empatada (acta capturada a medias) → se vuelve a pedir', async () => {
    const e = await escenario();
    const m = await terminado(e, { hs: 1, as: 1, hp: 1, ap: 1 });
    expect(await ids(e.seasonId)).toContain(m);
  });

  it('T-048: tanda decidida y goles cuadrados → no se pide', async () => {
    const e = await escenario();
    const m = await terminado(e, { hs: 3, as: 3, hp: 2, ap: 1 });
    expect(await ids(e.seasonId)).not.toContain(m);
  });

  it('T-049: empate de fase de grupos sin tanda → no se pide', async () => {
    const e = await escenario();
    const m = await terminado(e, { hs: 2, as: 2 });
    expect(await ids(e.seasonId)).not.toContain(m);
  });
});
