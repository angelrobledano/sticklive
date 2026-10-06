/**
 * Pagos con Google Play (payments-play.ts) — idempotencia, cross-account y
 * lifetime contra Postgres real. Router real montado en Hono; mockeados SOLO
 * lib/play.js (la API de Google) y session-lookup.js (la sesión Bearer). Así
 * la idempotencia (UNIQUE + ON CONFLICT), la transacción de concesión y el
 * guard se ejercitan de verdad, igual que en stripe.integration.test.ts.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';

// La clase del mock es la MISMA referencia que importa el router (el test la
// recibe al importar lib/play.js): `instanceof PlayApiError` funciona.
const { getSubscription, getProduct, userFromBearer, PlayApiError } = vi.hoisted(() => {
  class PlayApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'PlayApiError';
      this.status = status;
    }
  }
  return {
    getSubscription: vi.fn(),
    getProduct: vi.fn(),
    userFromBearer: vi.fn(),
    PlayApiError,
  };
});

vi.mock('../../apps/api/src/lib/play.js', () => ({
  getSubscription,
  getProduct,
  PlayApiError,
  listVoidedPurchases: vi.fn(),
  getPlayCredentials: vi.fn(() => ({ email: '', privateKey: '' })),
  buildPlayJwt: vi.fn(),
  getAccessToken: vi.fn(),
}));

vi.mock('../../apps/api/src/lib/session-lookup.js', () => ({ userFromBearer }));

const { playRouter } = await import('../../apps/api/src/routes/payments-play.js');

const app = new Hono();
app.route('/payments/play', playRouter);

// IP única por petición: el rate limit es por (ruta + IP) y su store es
// module-level; así ningún test agota la ventana del siguiente.
let ipSeq = 0;
const nextIp = (): string => `10.8.${(ipSeq += 1)}.1`;

const verify = (body: Record<string, unknown>, conSesion: boolean) =>
  app.request('/payments/play/verify', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': nextIp(),
      ...(conSesion ? { Authorization: 'Bearer sesion-de-prueba' } : {}),
    },
  });

const status = () =>
  app.request('/payments/play/status', {
    headers: { 'x-forwarded-for': nextIp(), Authorization: 'Bearer sesion-de-prueba' },
  });

async function crearUsuario(deviceId: string, premiumLifetime = false): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO users (device_id, premium_lifetime) VALUES ($1, $2) RETURNING id`,
    [deviceId, premiumLifetime]
  );
  return r.rows[0]!.id;
}

beforeEach(async () => {
  await limpiar();
  vi.clearAllMocks();
});
afterAll(async () => {
  await closeDb();
});

describe('POST /payments/play/verify (integración real)', () => {
  it('T-1: 401 sin sesión', async () => {
    userFromBearer.mockResolvedValue(null);
    const res = await verify(
      { purchaseToken: 'token123456', productId: 'premium_lifetime' },
      false
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('T-2: lifetime concede premium_lifetime permanente en users', async () => {
    const userId = await crearUsuario('dev-play-1');
    userFromBearer.mockResolvedValue({ id: userId, email: null });
    getProduct.mockResolvedValue({ kind: 'product', valid: true, purchased: true });

    const res = await verify(
      { purchaseToken: 'token-lifetime-1', productId: 'premium_lifetime' },
      true
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      premium: true,
      premiumUntil: null,
      premiumLifetime: true,
    });

    const u = await db.query<{ premium_lifetime: boolean; is_premium: boolean }>(
      `SELECT premium_lifetime, is_premium FROM users WHERE id = $1`,
      [userId]
    );
    expect(u.rows[0]!.premium_lifetime).toBe(true);
    expect(u.rows[0]!.is_premium).toBe(true);

    const p = await db.query<{ user_id: string; product_id: string; state: string }>(
      `SELECT user_id, product_id, state FROM play_purchases WHERE purchase_token = $1`,
      ['token-lifetime-1']
    );
    expect(p.rows[0]).toMatchObject({
      user_id: userId,
      product_id: 'premium_lifetime',
      state: 'active',
    });
  });

  it('T-3: idempotencia real — reenviar el mismo token no re-otorga ni duplica', async () => {
    const userId = await crearUsuario('dev-play-2');
    userFromBearer.mockResolvedValue({ id: userId, email: null });
    getProduct.mockResolvedValue({ kind: 'product', valid: true, purchased: true });

    const primera = await verify(
      { purchaseToken: 'token-dup-1', productId: 'premium_lifetime' },
      true
    );
    expect(primera.status).toBe(200);

    const segunda = await verify(
      { purchaseToken: 'token-dup-1', productId: 'premium_lifetime' },
      true
    );
    expect(segunda.status).toBe(200);
    expect(await segunda.json()).toMatchObject({ premium: true, premiumLifetime: true });

    const p = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM play_purchases WHERE purchase_token = $1`,
      ['token-dup-1']
    );
    expect(p.rows[0]!.n).toBe(1);
    expect(getProduct).toHaveBeenCalledTimes(1); // la segunda NO vuelve a Google
  });

  it('T-4: token registrado por OTRO usuario → 409 y sin cambios', async () => {
    const owner = await crearUsuario('dev-play-owner');
    const other = await crearUsuario('dev-play-other');
    getProduct.mockResolvedValue({ kind: 'product', valid: true, purchased: true });

    userFromBearer.mockResolvedValue({ id: owner, email: null });
    const primera = await verify(
      { purchaseToken: 'token-shared-1', productId: 'premium_lifetime' },
      true
    );
    expect(primera.status).toBe(200);

    userFromBearer.mockResolvedValue({ id: other, email: null });
    const res = await verify(
      { purchaseToken: 'token-shared-1', productId: 'premium_lifetime' },
      true
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'token_owned_by_other_user' });

    const o = await db.query<{ premium_lifetime: boolean; is_premium: boolean }>(
      `SELECT premium_lifetime, is_premium FROM users WHERE id = $1`,
      [other]
    );
    expect(o.rows[0]!.premium_lifetime).toBe(false);
    expect(o.rows[0]!.is_premium).toBe(false);

    // Solo la fila del dueño: al secuestrado no se le registra nada.
    const filas = await db.query<{ user_id: string }>(
      `SELECT user_id FROM play_purchases WHERE purchase_token = $1`,
      ['token-shared-1']
    );
    expect(filas.rows).toHaveLength(1);
    expect(filas.rows[0]!.user_id).toBe(owner);
  });

  it('T-5: anual activa concede premium_until = expiración de Play', async () => {
    const userId = await crearUsuario('dev-play-3');
    userFromBearer.mockResolvedValue({ id: userId, email: null });
    getSubscription.mockResolvedValue({
      kind: 'subscription',
      valid: true,
      active: true,
      expiresAt: new Date('2030-06-01T00:00:00Z'),
    });

    const res = await verify(
      { purchaseToken: 'token-annual-1', productId: 'premium_annual' },
      true
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      premium: true,
      premiumUntil: '2030-06-01T00:00:00.000Z',
      premiumLifetime: false,
    });

    const p = await db.query<{ expires_at: Date | string | null }>(
      `SELECT expires_at FROM play_purchases WHERE purchase_token = $1`,
      ['token-annual-1']
    );
    expect(new Date(p.rows[0]!.expires_at!).toISOString()).toBe('2030-06-01T00:00:00.000Z');
  });

  it('T-6: Google caído → 502 explícito y NADA concedido', async () => {
    const userId = await crearUsuario('dev-play-4');
    userFromBearer.mockResolvedValue({ id: userId, email: null });
    getSubscription.mockRejectedValue(
      new PlayApiError(503, 'play_api_error: google respondió 503')
    );

    const res = await verify(
      { purchaseToken: 'token-down-1', productId: 'premium_annual' },
      true
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'play_unavailable' });

    const u = await db.query<{ is_premium: boolean; premium_until: Date | null }>(
      `SELECT is_premium, premium_until FROM users WHERE id = $1`,
      [userId]
    );
    expect(u.rows[0]!.is_premium).toBe(false);
    expect(u.rows[0]!.premium_until).toBeNull();

    const p = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM play_purchases`, []);
    expect(p.rows[0]!.n).toBe(0);
  });

  it('T-7: anual con contrato violado (valid:true, expiresAt:null) → 422 y 0 filas', async () => {
    const userId = await crearUsuario('dev-play-5');
    userFromBearer.mockResolvedValue({ id: userId, email: null });
    // Contrato violado por el cliente: una suscripción "válida" sin expiración
    // no puede conceder (el CHECK de la 070 exige expires_at en la anual).
    getSubscription.mockResolvedValue({
      kind: 'subscription',
      valid: true,
      active: true,
      expiresAt: null,
    });

    const res = await verify(
      { purchaseToken: 'token-noexp-1', productId: 'premium_annual' },
      true
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'purchase_not_valid' });

    const p = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM play_purchases WHERE purchase_token = $1`,
      ['token-noexp-1']
    );
    expect(p.rows[0]!.n).toBe(0);

    const u = await db.query<{ is_premium: boolean; premium_until: Date | null }>(
      `SELECT is_premium, premium_until FROM users WHERE id = $1`,
      [userId]
    );
    expect(u.rows[0]!.is_premium).toBe(false);
    expect(u.rows[0]!.premium_until).toBeNull();
  });
});

describe('GET /payments/play/status (integración real)', () => {
  it('T-8: usuario con premium_lifetime responde premium permanente', async () => {
    const userId = await crearUsuario('dev-play-status', true);
    userFromBearer.mockResolvedValue({ id: userId, email: null });

    const res = await status();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      premium: true,
      premiumLifetime: true,
      premiumUntil: null,
    });
  });
});
