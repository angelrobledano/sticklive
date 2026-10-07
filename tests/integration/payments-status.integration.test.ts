/**
 * GET /payments/status (payments-status.ts) — estado premium de la sesión
 * Bearer, contra Postgres real. Router real; NO se mockea nada: la sesión se
 * inserta directamente en user_sessions con un token conocido, igual que el
 * flujo real (token en claro → SHA-256 en BD).
 */
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';

// Sin mocks: session-lookup y el router son código nuestro y corren REAL —
// token en claro → SHA-256 en BD → JOIN con users, exactamente como producción.

const { statusRouter } = await import('../../apps/api/src/routes/payments-status.js');

const app = new Hono();
app.route('/payments/status', statusRouter);

const BEARER = 'test-bearer-token-status';
const TOKEN_HASH = createHash('sha256').update(BEARER).digest('hex');

async function crearUsuarioConSesion(
  deviceId: string,
  premium: { until: string | null; lifetime: boolean }
): Promise<void> {
  const u = await db.query<{ id: string }>(
    `INSERT INTO users (device_id, premium_until, premium_lifetime) VALUES ($1, $2, $3) RETURNING id`,
    [deviceId, premium.until, premium.lifetime]
  );
  await db.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [u.rows[0]!.id, TOKEN_HASH]
  );
}

const get = (auth?: string) =>
  app.request('/payments/status', {
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  });

beforeEach(async () => {
  await limpiar();
});
afterAll(async () => { await closeDb(); });

describe('GET /payments/status (integración real)', () => {
  it('T-1: 401 sin cabecera y con token inexistente', async () => {
    const noAuth = await get();
    expect(noAuth.status).toBe(401);
    const badToken = await get('otro-token-que-no-existe');
    expect(badToken.status).toBe(401);
  });

  it('T-2: lifetime puro (premium_until NULL) → premium true permanente', async () => {
    await crearUsuarioConSesion('dev-status-lifetime', { until: null, lifetime: true });
    const res = await get(BEARER);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ premium: true, premiumLifetime: true, premiumUntil: null });
  });

  it('T-3: anual vigente → premium true con premiumUntil; caducada → premium false', async () => {
    await crearUsuarioConSesion('dev-status-annual', { until: '2030-06-01T00:00:00Z', lifetime: false });
    const vigente = await get(BEARER);
    expect(await vigente.json()).toMatchObject({ premium: true, premiumUntil: '2030-06-01T00:00:00.000Z' });

    // Misma fila caducada: el guard la excluye (S9)
    await db.query(`UPDATE users SET premium_until = '2020-01-01T00:00:00Z' WHERE device_id = $1`,
      ['dev-status-annual']);
    const caducada = await get(BEARER);
    expect(await caducada.json()).toMatchObject({ premium: false });
  });
});
