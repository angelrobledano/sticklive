/**
 * Cadena live E2E (#186): scheduled → (feed mc) live → gol → NOTIFY → estado expuesto.
 *
 * La hora NUNCA hace LIVE: el estado expuesto es el de la BD, que solo pasa a
 * `live` con la señal explícita del feed (resolveStatusTransition).
 *
 * Cada eslabón estaba testado por separado; esto los une y verifica la secuencia
 * real del directo contra Postgres (incluido el NOTIFY de la migración 043).
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { db, closeDb, listenForNotifications, replaceMatchEvents, upsertMatch, type NotificationListener } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearPartido, crearFuente, type EscenarioPartido } from './support/factorias.js';
import { matchDisplayState } from '@sports/shared-types';

const SOURCE_REF = 'm-chain-1';

async function waitFor(cond: () => boolean, timeoutMs = 3_000, stepMs = 50): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return cond();
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let escenario: EscenarioPartido;
let sourceId: string;
let listener: NotificationListener | null = null;
const received: string[] = [];
const countOf = (matchId: string) => received.filter((p) => p === matchId).length;

beforeAll(async () => {
  listener = listenForNotifications('match_update', (payload) => { received.push(payload); });
  await sleep(500); // deja activarse la conexión LISTEN
});

beforeEach(async () => {
  await limpiar();
  sourceId = await crearFuente();
  escenario = await crearPartido({ status: 'scheduled', sourceRef: SOURCE_REF });
});

afterAll(async () => {
  await listener?.close();
  await closeDb();
});

describe('cadena live E2E (#186)', () => {
  test('T-033 scheduled → live (feed) → gol (NOTIFY) → estado expuesto live', async () => {
    // 1) Partido scheduled cuya hora acaba de pasar (saque hace 2 s). Sin señal
    //    de la fuente NO está en directo: se muestra "pendiente de inicio".
    const kickoff = new Date(Date.now() - 2_000);
    await db.query(`UPDATE matches SET scheduled_at = $2 WHERE id = $1`, [escenario.matchId, kickoff]);
    expect(matchDisplayState('scheduled', kickoff, Date.now())).toBe('awaiting_start');

    const antes = (await db.query<{ status: string }>(
      `SELECT status FROM matches WHERE id = $1`, [escenario.matchId])).rows[0]!;
    expect(antes.status).toBe('scheduled');

    // 2) El feed mc (clase playing) trae el partido: upsert → status='live'.
    await upsertMatch({
      seasonId: escenario.seasonId,
      homeTeamId: escenario.homeTeamId,
      awayTeamId: escenario.awayTeamId,
      status: 'live',
      scheduledAt: kickoff,
      sourceRef: SOURCE_REF,
    });
    const vivo = (await db.query<{ status: string }>(
      `SELECT status FROM matches WHERE id = $1`, [escenario.matchId])).rows[0]!;
    expect(vivo.status).toBe('live');

    // 3) Un gol nuevo (acta) emite NOTIFY('match_update', matchId).
    const base = countOf(escenario.matchId);
    await replaceMatchEvents(escenario.matchId, [{
      teamId: escenario.homeTeamId, playerId: null, eventType: 'goal',
      minute: 1, period: 1, clock: '24:00', detail: null,
      sourceId, sourceRef: 'goal-1', scrapedAt: new Date(),
    }]);
    expect(await waitFor(() => countOf(escenario.matchId) > base)).toBe(true);

    // 4) El estado expuesto sigue siendo EN DIRECTO.
    const fila = (await db.query<{ status: string; scheduled_at: Date }>(
      `SELECT status, scheduled_at FROM matches WHERE id = $1`, [escenario.matchId])).rows[0]!;
    expect(matchDisplayState(fila.status, fila.scheduled_at, Date.now())).toBe('live');
  });
});
