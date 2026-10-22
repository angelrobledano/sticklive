/**
 * B5 — exhaustividad del acta en `matches.event_coverage`.
 *
 * OKMob expone por acta `ev` (nº de eventos) y `stale`. Nosotros teníamos
 * 'full' en cuanto llegaba un acta con eventos. Ahora:
 *   full    — terminado y los goles del acta suman el marcador,
 *   partial — en juego, o terminado con el acta descuadrada
 *             (wse_match_3248: 0-6 con 0-2 en acta),
 *   none    — solo marcador (volcado histórico): no se toca.
 * Se recalcula al cargar el acta y cuando cambian estado o marcador.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, closeDb, refreshEventCoverage } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearPartido } from './support/factorias.js';

beforeEach(limpiar);
afterAll(closeDb);

async function gol(matchId: string, teamId: string, ref: string) {
  await db.query(
    `INSERT INTO match_events (match_id, match_date, team_id, event_type, source_ref)
     SELECT id, scheduled_at::date, $2, 'goal', $3 FROM matches WHERE id = $1`, [matchId, teamId, ref]);
}
const cobertura = async (id: string) =>
  (await db.query<{ event_coverage: string }>(`SELECT event_coverage FROM matches WHERE id = $1`, [id])).rows[0]!.event_coverage;

describe('B5 — refreshEventCoverage', () => {
  it('terminado y cuadrado: full; descuadrado: partial', async () => {
    const e = await crearPartido();
    await db.query(`UPDATE matches SET status='finished', home_score=1, away_score=0, scheduled_at=NOW() WHERE id=$1`, [e.matchId]);
    await gol(e.matchId, e.homeTeamId, 'g1');
    await refreshEventCoverage(e.matchId);
    expect(await cobertura(e.matchId)).toBe('full');

    await db.query(`UPDATE matches SET away_score = 2 WHERE id = $1`, [e.matchId]);
    expect(await cobertura(e.matchId)).toBe('partial');
  });

  it('en juego es partial y pasa a full al terminar (trigger)', async () => {
    const e = await crearPartido();
    await db.query(`UPDATE matches SET status='live', home_score=1, away_score=0, scheduled_at=NOW() WHERE id=$1`, [e.matchId]);
    await gol(e.matchId, e.homeTeamId, 'g1');
    await refreshEventCoverage(e.matchId);
    expect(await cobertura(e.matchId)).toBe('partial');
    await db.query(`UPDATE matches SET status='finished' WHERE id=$1`, [e.matchId]);
    expect(await cobertura(e.matchId)).toBe('full');
  });

  it('sin eventos no toca la bandera, y un partido sin acta (none) sigue en none', async () => {
    const e = await crearPartido();
    await db.query(`UPDATE matches SET status='finished', home_score=3, away_score=1, event_coverage='none' WHERE id=$1`, [e.matchId]);
    await refreshEventCoverage(e.matchId);
    expect(await cobertura(e.matchId)).toBe('none');
  });
});
