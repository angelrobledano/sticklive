/**
 * SSE corte por duración máxima (#378): con SSE_MAX_DURATION_MS corto, el
 * stream envía `event: timeout` y CIERRA — la válvula anti-conexiones-zombi.
 * El cliente reconecta al recibirlo (retry: anunciable, #371).
 *
 * Fichero separado porque los consts del módulo se congelan al importarlo:
 * aquí la duración máxima es de 400 ms.
 */
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { closeDb } from '@sports/db';
import { limpiar } from './support/db.js';
import { crearPartido, type EscenarioPartido } from './support/factorias.js';

process.env['SSE_BACKUP_POLL_MS'] = '60000';
process.env['SSE_MAX_DURATION_MS'] = '400';
process.env['SSE_RETRY_MS'] = '50';
process.env['SSE_MAX_CONNECTIONS_PER_IP'] = '10';
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

describe('SSE corte por duración (#378)', () => {
  it('envía event:timeout y cierra al agotar SSE_MAX_DURATION_MS', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/matches/${escenario.matchId}/stream`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const seen: string[] = [];

    const fin = await (async (): Promise<boolean> => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) return true;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const m = /^event:(.+)$/m.exec(block);
          if (m) seen.push(m[1]!.trim());
          if (seen[seen.length - 1] === 'timeout') return true;
        }
      }
      return false;
    })();

    expect(fin).toBe(true);
    expect(seen).toContain('snapshot');
    expect(seen[seen.length - 1]).toBe('timeout');
  });
});
