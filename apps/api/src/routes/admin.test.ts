import { describe, it, expect } from 'vitest';

// `@sports/db` exige DATABASE_URL al importarse (aunque el pool no conecta hasta
// la primera query). Fijamos una de mentira ANTES del import dinámico. El token
// de admin también se lee en tiempo de request (middleware).
process.env['DATABASE_URL'] ??= 'postgres://localhost:5432/test';
process.env['ADMIN_TOKEN'] ??= 'test-token';

const { adminRouter } = await import('./admin.js');

const AUTH = { 'x-admin-token': 'test-token' };
const JSON_HEADERS = { ...AUTH, 'content-type': 'application/json' };

/**
 * #321: un `:id` no-UUID llegaba al cast a uuid de Postgres y devolvía 500
 * (o un 409 engañoso). Debe rechazarse ANTES de tocar la BD. Los guards no
 * ejecutan queries, así que estos tests no necesitan Postgres real.
 */
describe('admin — ids malformados no llegan a la BD (#321)', () => {
  it('PATCH /users/:id/status → 404', async () => {
    const res = await adminRouter.request('/users/xyz/status', {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ status: 'active' }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /users/:id → 404', async () => {
    const res = await adminRouter.request('/users/xyz', { method: 'DELETE', headers: AUTH });
    expect(res.status).toBe(404);
  });

  it('POST /competitions/:id/archive → 404', async () => {
    const res = await adminRouter.request('/competitions/xyz/archive', { method: 'POST', headers: AUTH });
    expect(res.status).toBe(404);
  });

  it('POST /competitions/:id/restore → 404', async () => {
    const res = await adminRouter.request('/competitions/xyz/restore', { method: 'POST', headers: AUTH });
    expect(res.status).toBe(404);
  });

  it('POST /resolution-queue/:id/resolve → 404 antes de mirar el body', async () => {
    const res = await adminRouter.request('/resolution-queue/xyz/resolve', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ teamId: 'abc' }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /resolution-queue/:id/reject → 404', async () => {
    const res = await adminRouter.request('/resolution-queue/xyz/reject', { method: 'POST', headers: AUTH });
    expect(res.status).toBe(404);
  });

  it('POST /competitions/merge con ids no-UUID → 400', async () => {
    const res = await adminRouter.request('/competitions/merge', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ keepId: 'xyz', mergeId: 'abc' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /resolution-queue/:id/resolve con teamId no-UUID → 400', async () => {
    const res = await adminRouter.request('/resolution-queue/3f2504e0-4f89-41d3-9a0c-0305e82c3301/resolve', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ teamId: 'abc' }),
    });
    expect(res.status).toBe(400);
  });

  it('sin token sigue respondiendo 401 (no rompe la autenticación)', async () => {
    const res = await adminRouter.request('/users/xyz/status', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'active' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('admin — calidad (guards sin BD)', () => {
  it('PATCH /competitions/:id/quality con uuid inválido → 404', async () => {
    const res = await adminRouter.request('/competitions/xyz/quality', {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ dataQuality: 'ok' }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH /competitions/:id/quality con valor inválido → 400', async () => {
    const res = await adminRouter.request('/competitions/00000000-0000-0000-0000-000000000001/quality', {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ dataQuality: 'nope' }),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /seasons/:id/quality con uuid inválido → 404', async () => {
    const res = await adminRouter.request('/seasons/xyz/quality', {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ dataQuality: 'ok' }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH /seasons/:id/quality con valor inválido → 400', async () => {
    const res = await adminRouter.request('/seasons/00000000-0000-0000-0000-000000000001/quality', {
      method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ dataQuality: 'nope' }),
    });
    expect(res.status).toBe(400);
  });
});
