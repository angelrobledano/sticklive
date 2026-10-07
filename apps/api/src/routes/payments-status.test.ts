import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// Mocks mínimos: sesión Bearer y BD. El guard (isUserPremium) es real — es el
// comportamiento que protege este endpoint.
vi.mock('@sports/db', () => ({
  db: { query: vi.fn() },
}));

vi.mock('../lib/session-lookup.js', () => ({
  userFromBearer: vi.fn(),
}));

import { statusRouter } from './payments-status.js';
import { db } from '@sports/db';
import { userFromBearer } from '../lib/session-lookup.js';

const dbQuery = db.query as unknown as ReturnType<typeof vi.fn>;
const bearer = userFromBearer as unknown as ReturnType<typeof vi.fn>;

const app = new Hono();
app.route('/payments/status', statusRouter);

const get = (auth?: string) =>
  app.request('/payments/status', {
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /payments/status', () => {
  it('401 sin sesión', async () => {
    bearer.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('200 lifetime: premium true aunque premium_until sea null', async () => {
    bearer.mockResolvedValue({ id: 'u1', email: 'a@b.c' });
    dbQuery.mockResolvedValueOnce({
      rows: [{ premium_until: null, premium_lifetime: true }],
    });
    const res = await get('tok');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      premium: true,
      premiumUntil: null,
      premiumLifetime: true,
    });
  });

  it('200 anual vigente: premium true con premiumUntil en ISO', async () => {
    bearer.mockResolvedValue({ id: 'u1', email: 'a@b.c' });
    dbQuery.mockResolvedValueOnce({
      rows: [{ premium_until: new Date('2030-06-01T00:00:00Z'), premium_lifetime: false }],
    });
    const res = await get('tok');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      premium: true,
      premiumUntil: '2030-06-01T00:00:00.000Z',
      premiumLifetime: false,
    });
  });

  it('200 anual caducada: premium false (el guard manda, no el flag)', async () => {
    bearer.mockResolvedValue({ id: 'u1', email: 'a@b.c' });
    dbQuery.mockResolvedValueOnce({
      rows: [{ premium_until: '2020-01-01T00:00:00Z', premium_lifetime: false }],
    });
    const res = await get('tok');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ premium: false, premiumLifetime: false });
  });

  it('200 sin fila de usuario: premium false (fail-closed)', async () => {
    bearer.mockResolvedValue({ id: 'u1', email: 'a@b.c' });
    dbQuery.mockResolvedValueOnce({ rows: [] });
    const res = await get('tok');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ premium: false, premiumLifetime: false });
  });
});
