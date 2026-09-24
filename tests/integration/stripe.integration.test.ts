/**
 * Pagos con Stripe (payments-stripe.ts) — webhook, idempotencia y estado premium.
 *
 * Es dinero y entitlement, y el webhook es automático (Stripe reintenta). Se
 * monta el router real contra Postgres y se mockea SÓLO el SDK de Stripe: la
 * verificación de firma y checkout.sessions.create. La idempotencia
 * (processed_stripe_events) y la activación de premium se ejercitan de verdad.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';

// Spies del SDK, controlables por test (vi.hoisted → disponibles en el mock).
const { constructEventAsync, sessionsCreate } = vi.hoisted(() => ({
  constructEventAsync: vi.fn(),
  sessionsCreate: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class StripeMock {
    webhooks = { constructEventAsync };
    checkout = { sessions: { create: sessionsCreate } };
  },
}));

const { stripeRouter } = await import('../../apps/api/src/routes/payments-stripe.js');

const app = new Hono();
app.route('/payments/stripe', stripeRouter);

const webhook = (body = '{}') =>
  app.request('/payments/stripe/webhook', {
    method: 'POST', body,
    headers: { 'stripe-signature': 'sig-de-prueba' },
  });

async function crearUsuario(deviceId: string, premiumUntil: string | null = null): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO users (device_id, premium_until) VALUES ($1, $2) RETURNING id`,
    [deviceId, premiumUntil]
  );
  return r.rows[0]!.id;
}
const completedEvent = (id: string, userId: string, deviceId: string) => ({
  id, type: 'checkout.session.completed',
  data: { object: { metadata: { userId, deviceId }, amount_total: 499 } },
});

beforeAll(() => {
  process.env['STRIPE_SECRET_KEY'] = 'sk_test_dummy';
  process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_test_dummy';
});
beforeEach(async () => {
  await limpiar();
  constructEventAsync.mockReset();
  sessionsCreate.mockReset();
});
afterAll(async () => { await closeDb(); });

describe('webhook de Stripe', () => {
  it('T-009: rechaza una firma inválida con 400', async () => {
    constructEventAsync.mockRejectedValueOnce(new Error('firma inválida'));
    const res = await webhook();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_signature' });
  });

  it('T-011: checkout.session.completed activa premium (~1 año)', async () => {
    const userId = await crearUsuario('dev-activar');
    constructEventAsync.mockResolvedValueOnce(completedEvent('evt_act', userId, 'dev-activar'));
    const res = await webhook();
    expect(res.status).toBe(200);

    const u = await db.query<{ is_premium: boolean; premium_until: string | null }>(
      `SELECT is_premium, premium_until FROM users WHERE id = $1`, [userId]
    );
    expect(u.rows[0]!.is_premium).toBe(true);
    const until = new Date(u.rows[0]!.premium_until!).getTime();
    const u_year = 365 * 24 * 3600_000;
    expect(until).toBeGreaterThan(Date.now() + u_year - 5 * 24 * 3600_000);
  });

  it('T-010: es idempotente — un event.id repetido NO reactiva', async () => {
    const userId = await crearUsuario('dev-idem');
    constructEventAsync.mockResolvedValue(completedEvent('evt_dup', userId, 'dev-idem'));

    const res1 = await webhook();
    expect(res1.status).toBe(200);
    expect(await res1.json()).toMatchObject({ received: true });

    // Simulamos que el efecto se deshizo; el replay del MISMO evento no debe re-aplicarlo.
    await db.query(`UPDATE users SET is_premium = FALSE, premium_until = NULL WHERE id = $1`, [userId]);

    const res2 = await webhook();
    expect(res2.status).toBe(200);
    expect(await res2.json()).toMatchObject({ received: true, duplicate: true });

    const u = await db.query<{ premium_until: string | null }>(
      `SELECT premium_until FROM users WHERE id = $1`, [userId]
    );
    expect(u.rows[0]!.premium_until).toBeNull(); // no se reactivó

    const n = await db.query<{ c: string }>(`SELECT count(*) c FROM processed_stripe_events`);
    expect(Number(n.rows[0]!.c)).toBe(1);
  });
});

describe('checkout y status', () => {
  it('T-012: checkout con premium activo devuelve 409', async () => {
    const futuro = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
    await crearUsuario('dev-premium', futuro);
    const res = await app.request('/payments/stripe/checkout', {
      method: 'POST', body: JSON.stringify({ deviceId: 'dev-premium' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'already_premium' });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it('T-013: status refleja la caducidad de premium_until', async () => {
    const futuro = new Date(Date.now() + 10 * 24 * 3600_000).toISOString();
    const pasado = new Date(Date.now() - 24 * 3600_000).toISOString();
    await crearUsuario('dev-fut', futuro);
    await crearUsuario('dev-pas', pasado);

    const r1 = await app.request('/payments/stripe/status?deviceId=dev-fut');
    expect(await r1.json()).toMatchObject({ premium: true });
    const r2 = await app.request('/payments/stripe/status?deviceId=dev-pas');
    expect(await r2.json()).toMatchObject({ premium: false });
  });
});
