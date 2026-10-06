/**
 * Pagos con Google Play Billing — unit del router /payments/play.
 *
 * Mockeados: @sports/db, lib/session-lookup (sesión Bearer), lib/play (API de
 * Google) y @sports/analytics. El router es REAL: se ejercitan la validación
 * de entrada, la idempotencia por token, la propiedad del token, la carrera
 * del ON CONFLICT y el mapeo de errores de Play. La capa de persistencia real
 * (Postgres) se cubre en el test de integración.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Hono } from 'hono';

vi.mock('@sports/db', () => ({
  db: { query: vi.fn() },
  withTransaction: vi.fn(),
  findPurchaseByToken: vi.fn(),
}));

vi.mock('../lib/session-lookup.js', () => ({
  userFromBearer: vi.fn(),
}));

// La clase del mock es la MISMA referencia que importa el router (el test la
// recibe al importar ../lib/play.js): `instanceof PlayApiError` funciona.
vi.mock('../lib/play.js', () => ({
  getSubscription: vi.fn(),
  getProduct: vi.fn(),
  PlayApiError: class PlayApiError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'PlayApiError';
      this.status = status;
    }
  },
}));

vi.mock('@sports/analytics', () => ({
  analytics: { capture: vi.fn(), flush: vi.fn() },
}));

import { db, findPurchaseByToken, withTransaction, type DbPlayPurchase } from '@sports/db';
import { analytics } from '@sports/analytics';
import { userFromBearer } from '../lib/session-lookup.js';
import { getProduct, getSubscription, PlayApiError } from '../lib/play.js';
import { playRouter } from './payments-play.js';

const USER = { id: 'u1', email: null } as const;

/**
 * `db.query` está sobrecargado en @types/pg y vi.mocked resuelve al último
 * overload (el de callback, void): se usa un handle tipado como Mock.
 */
const dbQuery = db.query as unknown as Mock;

/** Resultado de pg mínimo (QueryResult exige command/rowCount/oid/fields). */
const result = (rows: Array<Record<string, unknown>>) => ({
  command: 'SELECT',
  rowCount: rows.length,
  oid: 0,
  fields: [],
  rows,
});

function purchaseRow(overrides: Partial<DbPlayPurchase> = {}): DbPlayPurchase {
  return {
    id: 'p-1',
    user_id: USER.id,
    product_id: 'premium_lifetime',
    purchase_token: 'tok-12345678',
    order_id: null,
    state: 'active',
    expires_at: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

type TxClient = Parameters<Parameters<typeof withTransaction>[0]>[0];

/** Queries del cliente de transacción del mock: asertables por test. */
const txQuery = vi.fn(async () => result([{ user_id: USER.id }]));

function buildApp(): Hono {
  const app = new Hono();
  app.route('/payments/play', playRouter);
  return app;
}

// IP única por petición: el rate limit es por (ruta + IP) y su store es
// module-level; así ningún test agota la ventana del siguiente.
let ipSeq = 0;
const nextIp = (): string => `10.7.${(ipSeq += 1)}.1`;

const verify = (body: Record<string, unknown>) =>
  buildApp().request('/payments/play/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp() },
    body: JSON.stringify(body),
  });

const status = () =>
  buildApp().request('/payments/play/status', {
    headers: { 'x-forwarded-for': nextIp() },
  });

beforeEach(() => {
  vi.clearAllMocks();
  // Transacción feliz por defecto: INSERT con fila devuelta.
  txQuery.mockImplementation(async () => result([{ user_id: USER.id }]));
  vi.mocked(withTransaction).mockImplementation(async (fn) =>
    fn({ query: txQuery } as unknown as TxClient)
  );
  vi.mocked(userFromBearer).mockResolvedValue({ ...USER });
});

describe('POST /payments/play/verify — validación de entrada', () => {
  it('401 sin sesión', async () => {
    vi.mocked(userFromBearer).mockResolvedValue(null);
    const res = await verify({ purchaseToken: 'tok-12345678', productId: 'premium_lifetime' });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'unauthorized' });
    expect(findPurchaseByToken).not.toHaveBeenCalled();
  });

  it('400 sin purchaseToken', async () => {
    const res = await verify({ productId: 'premium_lifetime' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'missing_purchase_token' });
  });

  it('400 con purchaseToken demasiado corto (<8)', async () => {
    const res = await verify({ purchaseToken: 'corto', productId: 'premium_lifetime' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'missing_purchase_token' });
  });

  it('400 con producto desconocido y sin tocar Google', async () => {
    const res = await verify({ purchaseToken: 'tok-12345678', productId: 'premium_semanal' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unknown_product' });
    expect(getProduct).not.toHaveBeenCalled();
    expect(getSubscription).not.toHaveBeenCalled();
  });
});

describe('POST /payments/play/verify — concesión', () => {
  it('lifetime válida: INSERT+UPDATE en UNA transacción y entitlement concedido', async () => {
    vi.mocked(findPurchaseByToken).mockResolvedValue(null);
    vi.mocked(getProduct).mockResolvedValue({ kind: 'product', valid: true, purchased: true });
    dbQuery.mockResolvedValue(
      result([{ premium_until: null, premium_lifetime: true }])
    );

    const res = await verify({ purchaseToken: 'tok-lifetime-1', productId: 'premium_lifetime' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      premium: true,
      premiumUntil: null,
      premiumLifetime: true,
    });
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(txQuery).toHaveBeenCalledTimes(2);
    // expires_at NULL en lifetime: lo exige el CHECK de la migración 070.
    expect(txQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO play_purchases'),
      [USER.id, 'premium_lifetime', 'tok-lifetime-1', null]
    );
    expect(txQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('premium_lifetime = TRUE'),
      [USER.id]
    );
  });

  it('anual válida: premiumUntil = expiración de Play y UPDATE con GREATEST', async () => {
    vi.mocked(findPurchaseByToken).mockResolvedValue(null);
    vi.mocked(getSubscription).mockResolvedValue({
      kind: 'subscription',
      valid: true,
      active: true,
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    });
    dbQuery.mockResolvedValue(
      result([{ premium_until: '2030-01-01T00:00:00.000Z', premium_lifetime: false }])
    );

    const res = await verify({ purchaseToken: 'tok-annual-1', productId: 'premium_annual' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      premium: true,
      premiumUntil: '2030-01-01T00:00:00.000Z',
      premiumLifetime: false,
    });
    expect(txQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO play_purchases'),
      [USER.id, 'premium_annual', 'tok-annual-1', '2030-01-01T00:00:00.000Z']
    );
    expect(txQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('GREATEST(COALESCE(premium_until, NOW())'),
      [USER.id, '2030-01-01T00:00:00.000Z']
    );
  });

  it('reintento benigno: token ya del mismo usuario responde entitlement SIN llamar a Google', async () => {
    vi.mocked(findPurchaseByToken).mockResolvedValue(purchaseRow());
    dbQuery.mockResolvedValue(
      result([{ premium_until: null, premium_lifetime: true }])
    );

    const res = await verify({ purchaseToken: 'tok-12345678', productId: 'premium_lifetime' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ premium: true, premiumLifetime: true });
    expect(getProduct).not.toHaveBeenCalled();
    expect(getSubscription).not.toHaveBeenCalled();
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('analítica premium_purchased (provider play) fuera de la transacción', async () => {
    vi.mocked(findPurchaseByToken).mockResolvedValue(null);
    vi.mocked(getProduct).mockResolvedValue({ kind: 'product', valid: true, purchased: true });
    dbQuery.mockResolvedValue(
      result([{ premium_until: null, premium_lifetime: true }])
    );

    await verify({ purchaseToken: 'tok-analytics', productId: 'premium_lifetime' });

    expect(analytics.capture).toHaveBeenCalledWith({
      distinctId: USER.id,
      event: 'premium_purchased',
      properties: { provider: 'play', product_id: 'premium_lifetime' },
    });
  });
});

describe('POST /payments/play/verify — compras inválidas y errores de Play', () => {
  it('compra no válida (valid=false) → 422 sin conceder nada', async () => {
    vi.mocked(findPurchaseByToken).mockResolvedValue(null);
    vi.mocked(getProduct).mockResolvedValue({ kind: 'product', valid: false, purchased: false });

    const res = await verify({ purchaseToken: 'tok-bad-1', productId: 'premium_lifetime' });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'purchase_not_valid' });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('PlayApiError 404 (token inexistente/falso) → 422 compra no válida', async () => {
    vi.mocked(findPurchaseByToken).mockResolvedValue(null);
    vi.mocked(getProduct).mockRejectedValue(
      new PlayApiError(404, 'play_api_error: google respondió 404')
    );

    const res = await verify({ purchaseToken: 'tok-fake-1', productId: 'premium_lifetime' });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'purchase_not_valid' });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('PlayApiError 503 (Google caído) → 502 play_unavailable', async () => {
    vi.mocked(findPurchaseByToken).mockResolvedValue(null);
    vi.mocked(getSubscription).mockRejectedValue(
      new PlayApiError(503, 'play_api_error: google respondió 503')
    );

    const res = await verify({ purchaseToken: 'tok-annual-2', productId: 'premium_annual' });

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'play_unavailable' });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('PlayApiError 0 (timeout) → 502 play_unavailable', async () => {
    vi.mocked(findPurchaseByToken).mockResolvedValue(null);
    vi.mocked(getProduct).mockRejectedValue(new PlayApiError(0, 'play_api_error: timeout'));

    const res = await verify({ purchaseToken: 'tok-slow-1', productId: 'premium_lifetime' });

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'play_unavailable' });
  });

  it('play_not_configured (Error plano, sin credenciales) → 503', async () => {
    vi.mocked(findPurchaseByToken).mockResolvedValue(null);
    vi.mocked(getProduct).mockRejectedValue(
      new Error('play_not_configured: faltan GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL / GOOGLE_PLAY_PRIVATE_KEY')
    );

    const res = await verify({ purchaseToken: 'tok-any-1', productId: 'premium_lifetime' });

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'play_not_configured' });
  });

  it('error inesperado → 500 server_error', async () => {
    vi.mocked(findPurchaseByToken).mockResolvedValue(null);
    vi.mocked(getProduct).mockRejectedValue(new Error('boom'));

    const res = await verify({ purchaseToken: 'tok-any-2', productId: 'premium_lifetime' });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: 'server_error' });
    expect(withTransaction).not.toHaveBeenCalled();
  });
});

describe('POST /payments/play/verify — propiedad del token y carrera', () => {
  it('token registrado por OTRO usuario → 409 sin llamar a Google ni conceder', async () => {
    vi.mocked(findPurchaseByToken).mockResolvedValue(purchaseRow({ user_id: 'otro' }));

    const res = await verify({ purchaseToken: 'tok-12345678', productId: 'premium_lifetime' });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'token_owned_by_other_user' });
    expect(getProduct).not.toHaveBeenCalled();
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('carrera: ON CONFLICT rowCount=0 y re-lectura de otro dueño → 409 sin conceder', async () => {
    vi.mocked(findPurchaseByToken)
      .mockResolvedValueOnce(null) // primera lectura: token libre
      .mockResolvedValueOnce(purchaseRow({ user_id: 'otro' })); // re-lectura: ocupado
    vi.mocked(getProduct).mockResolvedValue({ kind: 'product', valid: true, purchased: true });
    txQuery.mockImplementation(async () => result([])); // INSERT sin filas: perdió la carrera

    const res = await verify({ purchaseToken: 'tok-race-1', productId: 'premium_lifetime' });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'token_owned_by_other_user' });
    // Solo el INSERT: ningún UPDATE de concesión.
    expect(txQuery).toHaveBeenCalledTimes(1);
  });

  it('carrera: rowCount=0 pero el dueño es el mismo usuario → entitlement, sin analytics', async () => {
    vi.mocked(findPurchaseByToken)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(purchaseRow({ user_id: USER.id }));
    vi.mocked(getProduct).mockResolvedValue({ kind: 'product', valid: true, purchased: true });
    dbQuery.mockResolvedValue(
      result([{ premium_until: null, premium_lifetime: true }])
    );
    txQuery.mockImplementation(async () => result([]));

    const res = await verify({ purchaseToken: 'tok-race-2', productId: 'premium_lifetime' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ premium: true, premiumLifetime: true });
    // La concesión la hizo el verify en carrera: esta petición no reporta analytics.
    expect(analytics.capture).not.toHaveBeenCalled();
  });
});

describe('GET /payments/play/status', () => {
  it('401 sin sesión', async () => {
    vi.mocked(userFromBearer).mockResolvedValue(null);
    const res = await status();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('responde el entitlement de la sesión', async () => {
    dbQuery.mockResolvedValue(
      result([{ premium_until: '2030-01-01T00:00:00.000Z', premium_lifetime: false }])
    );

    const res = await status();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      premium: true,
      premiumUntil: '2030-01-01T00:00:00.000Z',
      premiumLifetime: false,
    });
    expect(db.query).toHaveBeenCalledWith(
      'SELECT premium_until, premium_lifetime FROM users WHERE id = $1',
      [USER.id]
    );
  });
});
