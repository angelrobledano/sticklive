/**
 * Sesiones multi-dispositivo (migración 053).
 *
 * Antes: users.session_token guardaba UNA sesión y cada login invalidaba la
 * anterior — fallo de producto confirmado: una cuenta debe poder estar
 * conectada a la vez en ordenador, móvil y tablet. Ahora: user_sessions,
 * N sesiones por usuario con tope de 5, caducidad de 90 días RENOVABLE por
 * uso (sliding) y hash-only en BD.
 *
 * Router real contra Postgres. Los logins pasan por /auth/verify igual que
 * en producción; la validez de cada token se comprueba con GET /auth/me.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { db, closeDb } from '@sports/db';
import { authRouter } from '../../apps/api/src/routes/auth.js';
import { adminRouter } from '../../apps/api/src/routes/admin.js';
import { limpiar } from './support/db.js';

const app = new Hono();
app.route('/auth', authRouter);
app.route('/admin', adminRouter);

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const ADMIN_TOKEN = 'test-admin-token';

beforeAll(() => {
  delete process.env['SMTP_HOST'];
  process.env['AUTH_DEV_LINKS'] = '0';
  process.env['ADMIN_TOKEN'] = ADMIN_TOKEN;
});
beforeEach(async () => { await limpiar(); });
afterAll(async () => { await closeDb(); });

/**
 * Login real: siembra magic link y canjea por /auth/verify. Devuelve el token
 * de sesión (claro). El email es compartido: simula la misma cuenta entrando
 * desde dispositivos distintos.
 */
async function login(token: string, deviceId: string, email: string): Promise<string> {
  await db.query(
    `INSERT INTO auth_tokens (token, email, expires_at)
     VALUES ($1, $2, NOW() + make_interval(mins => 15))`,
    [hash(token), email]
  );
  const res = await app.request('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ token, deviceId }),
    headers: { 'content-type': 'application/json' },
  });
  expect(res.status).toBe(200);
  const { session } = await res.json() as { session: string };
  expect(session).toBeTruthy();
  return session;
}

const me = (session: string) =>
  app.request('/auth/me', { headers: { Authorization: `Bearer ${session}` } });

/** Siembra una sesión directamente (para caducidades que el login no permite). */
async function sembrarSesion(deviceId: string, expiresIn: string): Promise<string> {
  const user = await db.query<{ id: string }>(
    `INSERT INTO users (device_id, email) VALUES ($1, $2) RETURNING id`,
    [deviceId, `${deviceId}@x.com`]
  );
  const token = `tok-raw-${deviceId}`;
  await db.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + $3::interval)`,
    [user.rows[0]!.id, hash(token), expiresIn]
  );
  return token;
}

const diasRestantes = async (session: string): Promise<number> => {
  const r = await db.query<{ dias: number }>(
    `SELECT EXTRACT(EPOCH FROM (expires_at - NOW())) / 86400 AS dias
       FROM user_sessions WHERE token_hash = $1`,
    [hash(session)]
  );
  return r.rows[0]!.dias;
};

describe('sesiones multi-dispositivo', () => {
  it('S-01/S-02: dos dispositivos, dos sesiones; el 2º login NO invalida la 1ª', async () => {
    const pc = await login('tok-pc', 'dev-pc', 'cuenta@x.com');
    expect((await me(pc)).status).toBe(200);

    const movil = await login('tok-movil', 'dev-movil', 'cuenta@x.com');

    // La sesión del PC sigue viva DESPUÉS del login del móvil (regresión del
    // comportamiento anterior, que la sobrescribía).
    expect((await me(pc)).status).toBe(200);
    expect((await me(movil)).status).toBe(200);

    const n = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM user_sessions`
    );
    expect(n.rows[0]!.n).toBe(2);
  });

  it('S-03: sesión caducada → 401', async () => {
    const tok = await sembrarSesion('dev-viejo', '-1 hour');
    expect((await me(tok)).status).toBe(401);
  });

  it('S-04: caducidad renovable — el uso empuja a +90d, y solo cuando toca', async () => {
    // Casi caducada: tras usarla, renueva a ~90 días.
    const porCaducar = await sembrarSesion('dev-slide', '2 hours');
    expect((await me(porCaducar)).status).toBe(200);
    const dias = await diasRestantes(porCaducar);
    expect(dias).toBeGreaterThan(89);
    expect(dias).toBeLessThanOrEqual(90);

    // Recién creada (89,5 días): el uso NO renueva aún (escritura como mucho
    // una vez al día).
    const fresca = await sembrarSesion('dev-fresca', '89 days 12 hours');
    expect((await me(fresca)).status).toBe(200);
    expect(await diasRestantes(fresca)).toBeLessThan(90);
  });

  it('S-05: tope de 5 sesiones — la 6ª expulsa a la más antigua', async () => {
    const tokens: string[] = [];
    for (let i = 1; i <= 6; i++) {
      tokens.push(await login(`tok-cap-${i}`, `dev-cap-${i}`, 'cap@x.com'));
    }
    const n = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM user_sessions`
    );
    expect(n.rows[0]!.n).toBe(5);

    expect((await me(tokens[0]!)).status).toBe(401); // la más antigua, fuera
    for (const tok of tokens.slice(1)) {
      expect((await me(tok)).status).toBe(200);
    }
  });

  it('S-06: cuenta deshabilitada → 401 aunque la sesión sea válida', async () => {
    const user = await db.query<{ id: string }>(
      `INSERT INTO users (device_id, email, status) VALUES ('dev-dis', 'dis@x.com', 'disabled') RETURNING id`
    );
    const token = 'tok-disabled';
    await db.query(
      `INSERT INTO user_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + make_interval(days => 90))`,
      [user.rows[0]!.id, hash(token)]
    );
    expect((await me(token)).status).toBe(401);
  });

  it('S-07: deshabilitar desde admin cierra TODAS las sesiones del usuario', async () => {
    const pc = await login('tok-admin-1', 'dev-a1', 'cuenta@x.com');
    const movil = await login('tok-admin-2', 'dev-a2', 'cuenta@x.com');

    const res = await app.request('/admin/users/desconocido/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
      headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    });
    expect(res.status).toBe(404); // guardia del endpoint

    const u = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'cuenta@x.com'`
    );
    const patch = await app.request(`/admin/users/${u.rows[0]!.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
      headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ ok: true, user: { closed_sessions: 2 } });

    expect((await me(pc)).status).toBe(401);
    expect((await me(movil)).status).toBe(401);
  });
});
