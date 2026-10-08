import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

// Dinero + validación de entrada: se mockean SOLO el SDK de Stripe y la BD; el
// router es el real. `@sports/db` exige DATABASE_URL al importarse.
process.env['DATABASE_URL'] ??= 'postgres://localhost:5432/test';
process.env['STRIPE_SECRET_KEY'] ??= 'sk_test_dummy';

const { sessionsCreate, sessionsList, customersList, dbQuery } = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
  sessionsList: vi.fn(),
  customersList: vi.fn(),
  dbQuery: vi.fn(),
}));

vi.mock('stripe', () => ({
  default: class StripeMock {
    checkout = { sessions: { create: sessionsCreate, list: sessionsList } };
    customers = { create: vi.fn(), list: customersList };
    webhooks = { constructEventAsync: vi.fn() };
  },
}));

vi.mock('@sports/db', () => ({
  db: { query: dbQuery },
  withTransaction: vi.fn(),
}));

const { stripeRouter } = await import('./payments-stripe.js');

const app = new Hono();
app.route('/payments/stripe', stripeRouter);

/**
 * Router + BD frescos por test: PRICE_CENTS y LIFETIME_PRICE_CENTS se leen del
 * entorno al cargar el módulo, así que para probar la configurabilidad hay que
 * resetear el registro de módulos tras `vi.stubEnv` y reimportar.
 */
async function freshStripeApp(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  const { stripeRouter: router } = await import('./payments-stripe.js');
  const a = new Hono();
  a.route('/payments/stripe', router);
  // `dbQuery` es un spy hoisted compartido por todas las instancias del mock.
  return { app: a, dbQuery };
}

const checkout = (a: Hono, body: unknown) =>
  a.request('/payments/stripe/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  sessionsCreate.mockReset();
  sessionsList.mockReset();
  customersList.mockReset();
  dbQuery.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * #252: el endpoint de verificación de sesión debe rechazar ids con formato
 * inválido ANTES de llamar a Stripe. Así un `session_id` arbitrario de la URL
 * nunca llega al proveedor ni puede conceder entitlement.
 */
describe('GET /payments/stripe/session/:id — validación', () => {
  it('rechaza un id sin formato de Checkout Session con 400', async () => {
    const res = await app.request('/payments/stripe/session/no-es-una-sesion');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_session_id' });
  });

  it('rechaza un id con prefijo correcto pero demasiado corto', async () => {
    const res = await app.request('/payments/stripe/session/cs_short');
    expect(res.status).toBe(400);
  });
});

/**
 * #251: el restore exige deviceId + email bien formados ANTES de tocar
 * Stripe/BD — un parámetro ausente o corrupto nunca debe llegar al proveedor.
 */
describe('POST /payments/stripe/restore — validación temprana', () => {
  it('rechaza sin deviceId', async () => {
    const res = await app.request('/payments/stripe/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.es' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'missing_device_id' });
  });

  it('rechaza sin email', async () => {
    const res = await app.request('/payments/stripe/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'dev-1' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'missing_email' });
  });

  it('rechaza un email mal formado', async () => {
    const res = await app.request('/payments/stripe/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'dev-1', email: 'no-es-un-email' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'missing_email' });
  });
});

/**
 * Checkout con dos productos (anual y de por vida). El precio lo construye la
 * API, así que se verifica el `price_data` y el `metadata.product` que decide
 * el entitlement en el webhook.
 */
describe('POST /payments/stripe/checkout — producto', () => {
  const userRow = {
    id: 'u1', premium_until: null, premium_lifetime: false, stripe_customer_id: 'cus_1',
  };

  const stubEditablePrices = () =>
    freshStripeApp({ PREMIUM_PRICE_EUR_CENTS: '499', PREMIUM_LIFETIME_PRICE_EUR_CENTS: '2999' });

  it('product: lifetime usa 2999 y metadata.product lifetime', async () => {
    const { app: a, dbQuery } = await stubEditablePrices();
    dbQuery.mockResolvedValueOnce({ rows: [userRow] });
    sessionsCreate.mockResolvedValueOnce({ url: 'https://checkout.stripe.test/life' });

    const res = await checkout(a, { deviceId: 'dev-1', product: 'lifetime' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ url: 'https://checkout.stripe.test/life' });

    const args = sessionsCreate.mock.calls[0]![0] as {
      line_items: Array<{ price_data: { unit_amount: number } }>;
      metadata: Record<string, string>;
    };
    expect(args.line_items[0]!.price_data.unit_amount).toBe(2999);
    expect(args.metadata).toMatchObject({ deviceId: 'dev-1', userId: 'u1', product: 'lifetime' });
  });

  it('sin product es anual (499) y metadata.product annual (compat)', async () => {
    const { app: a, dbQuery } = await stubEditablePrices();
    dbQuery.mockResolvedValueOnce({ rows: [userRow] });
    sessionsCreate.mockResolvedValueOnce({ url: 'https://checkout.stripe.test/anual' });

    const res = await checkout(a, { deviceId: 'dev-1' });
    expect(res.status).toBe(200);

    const args = sessionsCreate.mock.calls[0]![0] as {
      line_items: Array<{ price_data: { unit_amount: number } }>;
      metadata: Record<string, string>;
    };
    expect(args.line_items[0]!.price_data.unit_amount).toBe(499);
    expect(args.metadata['product']).toBe('annual');
  });

  it('product inválido → 400 unknown_product sin tocar la BD ni Stripe', async () => {
    const { app: a, dbQuery } = await freshStripeApp({});
    const res = await checkout(a, { deviceId: 'dev-1', product: 'x' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'unknown_product' });
    expect(dbQuery).not.toHaveBeenCalled();
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it('el precio lifetime es configurable por env', async () => {
    const { app: a, dbQuery } = await freshStripeApp({ PREMIUM_LIFETIME_PRICE_EUR_CENTS: '1999' });
    dbQuery.mockResolvedValueOnce({ rows: [userRow] });
    sessionsCreate.mockResolvedValueOnce({ url: 'https://checkout.stripe.test/otro' });

    await checkout(a, { deviceId: 'dev-1', product: 'lifetime' });

    const args = sessionsCreate.mock.calls[0]![0] as {
      line_items: Array<{ price_data: { unit_amount: number } }>;
    };
    expect(args.line_items[0]!.price_data.unit_amount).toBe(1999);
  });
});

/**
 * Restore: el entitlement que se concedia al re-instalar salia de "ultima
 * sesion pagada + 1 ano". Con el producto de por vida hay que distinguir una
 * compra lifetime (sin fecha) de una anual.
 */
describe('POST /payments/stripe/restore — producto lifetime', () => {
  const restore = (a: Hono, body: unknown) =>
    a.request('/payments/stripe/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('una compra lifetime concede lifetime sin fecha (no un año)', async () => {
    const { app: a, dbQuery } = await freshStripeApp({});
    dbQuery
      .mockResolvedValueOnce({ rows: [{ id: 'u1', premium_until: null, premium_lifetime: false, stripe_customer_id: null }] })
      .mockResolvedValueOnce({ rows: [] });
    customersList.mockResolvedValueOnce({ data: [{ id: 'cus_1' }] });
    sessionsList.mockResolvedValueOnce({
      data: [{ payment_status: 'paid', status: 'complete', created: 1_700_000_000, metadata: { product: 'lifetime' } }],
    });

    const res = await restore(a, { deviceId: 'dev-nuevo', email: 'a@b.es' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ premium: true, premiumUntil: null, premiumLifetime: true });

    const update = dbQuery.mock.calls[1]![0] as string;
    expect(update).toContain('premium_lifetime = TRUE');
    expect(update).not.toContain('premium_until');
  });
});
