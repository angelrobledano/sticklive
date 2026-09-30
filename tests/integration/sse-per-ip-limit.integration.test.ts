/**
 * SSE límite de conexiones por IP (#378): 503 al agotar el cupo y liberación al
 * terminar el stream. Fichero propio porque el limiter (`ConnectionLimiter`) es
 * una instancia de módulo: aquí el cupo por IP es 1 y NO hay otros tests
 * compartiendo el contador.
 *
 * La liberación se prueba por el camino DETERMINISTA: el stream termina
 * server-side al vencer SSE_MAX_DURATION_MS (1 s) — el corte por cliente
 * (cancel del reader) depende de que el socket note el cierre y puede tardar
 * hasta el keepalive, así que no es una condición de test fiable.
 */
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearPartido, type EscenarioPartido } from './support/factorias.js';

process.env['SSE_BACKUP_POLL_MS'] = '60000';
process.env['SSE_MAX_CONNECTIONS_PER_IP'] = '1';
process.env['SSE_MAX_CONNECTIONS'] = '10';
process.env['SSE_RETRY_MS'] = '50';
process.env['SSE_MAX_DURATION_MS'] = '1000';
process.env['SSE_KEEPALIVE_INTERVAL_MS'] = '50';

const { matchStreamRouter } = await import('../../apps/api/src/routes/match-stream.js');
const { Hono } = await import('hono');
const { serve } = await import('@hono/node-server');

const app = new Hono();
app.route('/matches', matchStreamRouter);
const server = serve({ fetch: app.fetch, port: 0 });
await new Promise<void>((r) => server.on('listening', () => r()));
const PORT = ((server as unknown as import('node:http').Server).address() as import('node:net').AddressInfo).port;

let escenario: EscenarioPartido;

beforeEach(async () => {
  await limpiar();
  escenario = await crearPartido({ status: 'live' });
});

afterAll(async () => {
  server.close();
  await closeDb();
});

describe('SSE límite por IP (#378)', () => {
  it('503 con el cupo agotado; liberación al terminar el stream (timeout server-side)', async () => {
    // s1 entra (200) y mantiene el cupo durante su ventana de 1 s.
    const res1 = await fetch(`http://127.0.0.1:${PORT}/matches/${escenario.matchId}/stream`);
    expect(res1.status).toBe(200);
    const reader1 = res1.body!.getReader();
    await reader1.read();

    // Inmediatamente después, la segunda conexión desde la misma IP: 503.
    const res2 = await fetch(`http://127.0.0.1:${PORT}/matches/${escenario.matchId}/stream`);
    expect(res2.status).toBe(503);
    expect(await res2.json()).toEqual({ error: 'too_many_connections' });

    // Cuando s1 vence (timeout server-side), el handler libera el cupo.
    const t0 = Date.now();
    let fin = false;
    while (Date.now() - t0 < 4000) {
      const { done, value } = await reader1.read();
      if (done) { fin = true; break; }
      if (Buffer.from(value).toString().includes('event: timeout')) { fin = true; break; }
    }
    expect(fin).toBe(true);

    // Ahora el cupo está libre: la tercera conexión entra.
    let res3Status = 0;
    for (let i = 0; i < 10 && res3Status !== 200; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const res3 = await fetch(`http://127.0.0.1:${PORT}/matches/${escenario.matchId}/stream`);
      res3Status = res3.status;
      if (res3.status === 200) await res3.body!.cancel().catch(() => {});
    }
    expect(res3Status).toBe(200);
  });
});
