/**
 * Trigger NOTIFY de partido (migración 043, punto 11 — LISTEN/NOTIFY).
 *
 * Valida el mecanismo de extremo a extremo con Postgres real: un cambio en el
 * marcador o un evento nuevo emiten `pg_notify('match_update', matchId)`, y un
 * UPDATE que no toca campos del directo NO lo emite (cláusula WHEN del trigger).
 * De paso ejercita el helper `listenForNotifications`.
 *
 * Nota: el propio INSERT del partido (crearPartido) ya emite un NOTIFY
 * (trg_matches_notify_ins). Por eso cada caso cuenta los avisos ADICIONALES a
 * ese alta, en vez de comprobar sólo la presencia del matchId.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, closeDb, listenForNotifications, type NotificationListener } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearPartido } from './support/factorias.js';

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
const countOf = (matchId: string) => received.filter((p) => p === matchId).length;

/** Crea un partido y espera el NOTIFY de su INSERT; devuelve el conteo base. */
async function crearYesperarAlta(): Promise<{ matchId: string; base: number }> {
  const { matchId } = await crearPartido({ status: 'live' });
  await waitFor(() => countOf(matchId) >= 1);
  return { matchId, base: countOf(matchId) };
}

beforeAll(async () => {
  await limpiar();
  listener = listenForNotifications('match_update', (payload) => { received.push(payload); });
  // La conexión LISTEN se abre de forma asíncrona: dale margen para activarse.
  await sleep(500);
});

afterAll(async () => {
  await listener?.close();
  await closeDb();
});

describe('trigger match_update (migración 043)', () => {
  it('un cambio de marcador emite un NOTIFY adicional', async () => {
    const { matchId, base } = await crearYesperarAlta();
    await db.query('UPDATE matches SET home_score = 1 WHERE id = $1', [matchId]);
    expect(await waitFor(() => countOf(matchId) > base)).toBe(true);
  });

  it('un evento nuevo emite un NOTIFY adicional', async () => {
    const { matchId, base } = await crearYesperarAlta();
    await db.query(
      `INSERT INTO match_events (match_id, event_type, match_date)
       VALUES ($1, 'goal',
               (SELECT COALESCE(scheduled_at::date, finished_at::date, DATE '1900-01-01') FROM matches WHERE id = $1))`,
      [matchId],
    );
    expect(await waitFor(() => countOf(matchId) > base)).toBe(true);
  });

  it('un UPDATE que NO toca campos del directo NO emite NOTIFY', async () => {
    const { matchId, base } = await crearYesperarAlta();
    // Sólo updated_at: la cláusula WHEN del trigger UPDATE no debe dispararse.
    await db.query('UPDATE matches SET updated_at = NOW() WHERE id = $1', [matchId]);
    await sleep(700); // margen para que, si se emitiera, llegase
    expect(countOf(matchId)).toBe(base);
  });
});
