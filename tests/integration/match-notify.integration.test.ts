/**
 * Trigger NOTIFY de partido (migración 043, punto 11 — LISTEN/NOTIFY).
 *
 * Valida el mecanismo de extremo a extremo con Postgres real: un cambio en el
 * marcador o un evento nuevo emiten `pg_notify('match_update', matchId)`, y un
 * UPDATE que no toca campos del directo NO lo emite (cláusula WHEN del trigger).
 * De paso ejercita el helper `listenForNotifications`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, closeDb, listenForNotifications, type NotificationListener } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearPartido } from './support/factorias.js';

/** Espera activamente a que `cond()` sea true, hasta `timeoutMs`. */
async function waitFor(cond: () => boolean, timeoutMs = 3_000, stepMs = 50): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return cond();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let listener: NotificationListener | null = null;
const received: string[] = [];

beforeAll(async () => {
  await limpiar();
  // Un único listener para todo el fichero; filtramos por matchId en cada caso.
  listener = listenForNotifications('match_update', (payload) => { received.push(payload); });
  // La conexión LISTEN se abre de forma asíncrona: dale margen para activarse.
  await sleep(500);
});

afterAll(async () => {
  await listener?.close();
  await closeDb();
});

describe('trigger match_update (migración 043)', () => {
  it('un cambio de marcador emite NOTIFY con el matchId', async () => {
    const { matchId } = await crearPartido({ status: 'live' });
    await db.query('UPDATE matches SET home_score = 1 WHERE id = $1', [matchId]);
    expect(await waitFor(() => received.includes(matchId))).toBe(true);
  });

  it('un evento nuevo emite NOTIFY con el matchId', async () => {
    const { matchId } = await crearPartido({ status: 'live' });
    await db.query(
      "INSERT INTO match_events (match_id, event_type) VALUES ($1, 'goal')",
      [matchId],
    );
    expect(await waitFor(() => received.includes(matchId))).toBe(true);
  });

  it('un UPDATE que NO toca campos del directo NO emite NOTIFY', async () => {
    const { matchId } = await crearPartido({ status: 'live' });
    // Sólo updated_at: la cláusula WHEN del trigger no debe dispararse.
    await db.query('UPDATE matches SET updated_at = NOW() WHERE id = $1', [matchId]);
    await sleep(700); // margen para que, si se emitiera, llegase
    expect(received).not.toContain(matchId);
  });
});
