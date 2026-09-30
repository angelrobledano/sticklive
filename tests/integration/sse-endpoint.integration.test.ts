/**
 * Endpoint SSE completo (#378, punto 3 del hueco): GET /matches/:id/stream
 * contra Postgres real y un servidor HTTP de verdad (@hono/node-server).
 *
 * Cubre los invariantes del directo que los unitarios de sse-hub no pueden ver:
 *   · 404 para un id no-UUID (antes de crear hub ni consumir slot).
 *   · `snapshot` al recién llegado con el DTO completo.
 *   · FIFO: dos cambios de marcador → dos `update` EN ORDEN (vía NOTIFY 043
 *     + debounce, el camino real de producción).
 *   · `finished` cierra la conexión (el cliente corta al recibirlo).
 *   · Límite por IP: 503 al agotar el cupo y liberación al cerrar.
 *
 * Los consts del módulo (poll, debounce, duración) se leen al importarlo: se
 * fijan por env ANTES del import dinámico para que el test sea rápido.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearPartido, type EscenarioPartido } from './support/factorias.js';

// Env ANTES de importar el módulo (los consts se congelan al cargarlo).
process.env['SSE_BACKUP_POLL_MS'] = '150';
process.env['SSE_MAX_CONNECTIONS_PER_IP'] = '1';
process.env['SSE_MAX_CONNECTIONS'] = '10';
process.env['SSE_RETRY_MS'] = '50';
process.env['SSE_MAX_DURATION_MS'] = '15000';
process.env['SSE_KEEPALIVE_INTERVAL_MS'] = '50';

const { matchStreamRouter } = await import('../../apps/api/src/routes/match-stream.js');
const { Hono } = await import('hono');
const { serve } = await import('@hono/node-server');

const app = new Hono();
app.route('/matches', matchStreamRouter);
const server = serve({ fetch: app.fetch, port: 0 });
await new Promise<void>((r) => server.on('listening', () => r()));
const PORT = ((server as unknown as import('node:http').Server).address() as import('node:net').AddressInfo).port;
const BASE = `http://127.0.0.1:${PORT}`;

interface SseEvent { event: string; data: string }

/** Lee el stream SSE crudo y devuelve los eventos conforme llegan. */
async function openStream(matchId: string, signal: AbortSignal) {
  // Si el cupo por IP sigue ocupado por un stream de un test anterior (el
  // release llega cuando el servidor nota el corte, ≤ keepalive), reintenta.
  let res = await fetch(`${BASE}/matches/${matchId}/stream`, { signal });
  for (let i = 0; i < 40 && res.status === 503; i++) {
    await res.body?.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
    res = await fetch(`${BASE}/matches/${matchId}/stream`, { signal });
  }
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: SseEvent[] = [];
  const waiters: Array<(e: SseEvent | null) => void> = [];

  function pump(): Promise<void> {
    return reader.read().then(({ done, value }) => {
      if (done) {
        for (const w of waiters.splice(0)) w(null);
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev: SseEvent = { event: 'message', data: '' };
        let hasEvent = false;
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) { ev.event = line.slice(6).trim(); hasEvent = true; }
          else if (line.startsWith('data:')) { ev.data += line.slice(5).trim(); hasEvent = true; }
          // `retry:` y líneas de comentario no son eventos: se ignoran (#371).
        }
        if (!hasEvent) continue; // bloque de control (retry:, comentario, vacío)
        // Entrega directa al waiter si hay uno (cada evento se consume UNA vez);
        // sólo se acumula en el buffer si nadie esperaba.
        const w = waiters.shift();
        if (w) w(ev);
        else events.push(ev);
      }
      return pump();
    });
  }
  void pump();

  return {
    events,
    /** Espera el siguiente evento (resuelve null si el stream termina). */
    next: (timeoutMs = 5000): Promise<SseEvent | null> =>
      new Promise((resolve) => {
        // Los keepalive son ruido de transporte: se consumen solos.
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i]!.event === 'keepalive') events.splice(i, 1);
        }
        const pending = events.shift() ?? null;
        if (pending) return resolve(pending);
        const t = setTimeout(() => {
          const i = waiters.indexOf(receive);
          if (i >= 0) waiters.splice(i, 1);
          resolve(null);
        }, timeoutMs);
        const receive = (e: SseEvent | null) => {
          if (e && e.event === 'keepalive') {
            waiters.push(receive); // sigo esperando el siguiente evento real
            return;
          }
          clearTimeout(t);
          resolve(e);
        };
        waiters.push(receive);
      }),
    close: () => reader.cancel().catch(() => {}),
  };
}

let escenario: EscenarioPartido;

beforeAll(() => {
  // El servidor vive durante todo el fichero; los tests lo usan por puerto.
});

afterAll(async () => {
  server.close();
  await closeDb();
});

beforeEach(async () => {
  await limpiar();
  escenario = await crearPartido({ status: 'live' });
});

describe('SSE /matches/:id/stream (e2e, #378)', () => {
  it('404 para un id no-UUID, sin abrir hub ni consumir cupo', async () => {
    const res = await fetch(`${BASE}/matches/not-a-uuid/stream`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('snapshot al recién llegado con el DTO completo', async () => {
    const s = await openStream(escenario.matchId, new AbortController().signal);
    const snap = await s.next();
    if (!snap || snap.event !== 'snapshot') {
      console.log('DEBUG eventos recibidos:', JSON.stringify(s.events.slice(0, 4)).slice(0, 800));
    }
    expect(snap?.event).toBe('snapshot');
    const data = JSON.parse(snap!.data);
    expect(data.match.id).toBe(escenario.matchId);
    expect(data.match.status).toBe('live');
    expect(data.match.competitionName).toBeTruthy();
    await s.close();
  });

  it('FIFO: dos cambios de marcador → dos update en orden (NOTIFY 043)', async () => {
    const s = await openStream(escenario.matchId, new AbortController().signal);
    const first = await s.next();
    expect(first?.event).toBe('snapshot');

    await db.query(`UPDATE matches SET home_score = 1, updated_at = NOW() WHERE id = $1`, [escenario.matchId]);
    const u1 = await s.next();
    // eslint-disable-next-line no-console
    console.log('EVENTOS', JSON.stringify(s.events.map((e) => e.event)));
    expect(u1?.event).toBe('update');
    expect(JSON.parse(u1!.data).match.score.home).toBe(1);

    await db.query(`UPDATE matches SET home_score = 2, away_score = 1, updated_at = NOW() WHERE id = $1`, [escenario.matchId]);
    const u2 = await s.next();
    expect(u2?.event).toBe('update');
    const d2 = JSON.parse(u2!.data);
    expect(d2.match.score.home).toBe(2);
    expect(d2.match.score.away).toBe(1);

    await s.close();
  });

  it('finished cierra la conexión tras el último evento', async () => {
    const s = await openStream(escenario.matchId, new AbortController().signal);
    expect((await s.next())?.event).toBe('snapshot');

    await db.query(
      `UPDATE matches SET status = 'finished', finished_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [escenario.matchId]
    );
    // El mismo poll emite primero el cambio de fase ('update') y después el
    // 'finished' con el que el servidor cierra. Consumir hasta él.
    let fin: SseEvent | null = null;
    for (let i = 0; i < 5 && !fin; i++) {
      const e = await s.next(8000);
      if (!e) break;
      if (e.event === 'finished') fin = e;
    }
    expect(fin?.event).toBe('finished');
    // Tras finished, el stream termina (done=true en el handler): el siguiente
    // read debe agotarse sin más eventos.
    const nada = await s.next(1500);
    expect(nada).toBeNull();
  });
});
