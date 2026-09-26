/**
 * Auth — canje de magic link (/verify) y resolución de usuario.
 *
 * Seguridad + entitlement: el enlace debe ser de UN SOLO USO, caducar, adoptar
 * al usuario anónimo del dispositivo, no romperse ante colisión de device_id,
 * respetar cuentas deshabilitadas y guardar la sesión HASHEADA. Router real
 * contra Postgres; el token se siembra hasheado como hace el propio endpoint.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { db, closeDb } from '@sports/db';
import { authRouter } from '../../apps/api/src/routes/auth.js';
import { limpiar } from './support/db.js';

const app = new Hono();
app.route('/auth', authRouter);

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

async function sembrarToken(token: string, email: string, expiresInMin = 15): Promise<void> {
  await db.query(
    `INSERT INTO auth_tokens (token, email, expires_at)
     VALUES ($1, $2, NOW() + make_interval(mins => $3::int))`,
    [hash(token), email, expiresInMin]
  );
}
const verify = (body: object) =>
  app.request('/auth/verify', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

beforeAll(() => { delete process.env['SMTP_HOST']; process.env['AUTH_DEV_LINKS'] = '0'; });
beforeEach(async () => { await limpiar(); });
afterAll(async () => { await closeDb(); });

describe('POST /auth/magic-link — validación', () => {
  it('T-016: email inválido → 400', async () => {
    const res = await app.request('/auth/magic-link', {
      method: 'POST', body: JSON.stringify({ email: 'no-es-email' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_email' });
  });
});

describe('POST /auth/verify', () => {
  it('T-017: el token se canjea UNA sola vez (2º intento → 410)', async () => {
    await sembrarToken('tok-uso', 'uso@x.com');
    const r1 = await verify({ token: 'tok-uso', deviceId: 'dev-uso' });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ email: 'uso@x.com' });
    const r2 = await verify({ token: 'tok-uso', deviceId: 'dev-uso' });
    expect(r2.status).toBe(410);
  });

  it('T-018: token caducado → 410', async () => {
    await sembrarToken('tok-viejo', 'viejo@x.com', -1); // ya expirado
    const res = await verify({ token: 'tok-viejo', deviceId: 'dev-v' });
    expect(res.status).toBe(410);
  });

  it('T-019: adopta al usuario anónimo del dispositivo', async () => {
    const anon = await db.query<{ id: string }>(
      `INSERT INTO users (device_id, email) VALUES ('dev-anon', NULL) RETURNING id`
    );
    const anonId = anon.rows[0]!.id;
    await sembrarToken('tok-adopt', 'adopt@x.com');
    const res = await verify({ token: 'tok-adopt', deviceId: 'dev-anon' });
    expect(res.status).toBe(200);

    const u = await db.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE device_id = 'dev-anon'`
    );
    expect(u.rows).toHaveLength(1);
    expect(u.rows[0]!.id).toBe(anonId);        // MISMO usuario, no uno nuevo
    expect(u.rows[0]!.email).toBe('adopt@x.com');
  });

  it('T-020: colisión de device_id → usuario nuevo con device derivado del email', async () => {
    await db.query(`INSERT INTO users (device_id, email) VALUES ('dev-ocupado', 'otro@x.com')`);
    await sembrarToken('tok-col', 'nuevo@x.com');
    const res = await verify({ token: 'tok-col', deviceId: 'dev-ocupado' });
    expect(res.status).toBe(200);

    const ocupado = await db.query<{ email: string }>(`SELECT email FROM users WHERE device_id = 'dev-ocupado'`);
    expect(ocupado.rows[0]!.email).toBe('otro@x.com'); // intacto
    const nuevo = await db.query<{ device_id: string }>(`SELECT device_id FROM users WHERE email = 'nuevo@x.com'`);
    expect(nuevo.rows[0]!.device_id).toBe('email:nuevo@x.com');
  });

  it('T-021: cuenta deshabilitada → 403', async () => {
    await db.query(`INSERT INTO users (device_id, email, status) VALUES ('dev-dis', 'dis@x.com', 'disabled')`);
    await sembrarToken('tok-dis', 'dis@x.com');
    const res = await verify({ token: 'tok-dis', deviceId: 'dev-dis' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'account_disabled' });
  });

  it('T-022: la sesión se guarda HASHEADA en user_sessions (el claro solo va al cliente)', async () => {
    await sembrarToken('tok-sess', 'sess@x.com');
    const res = await verify({ token: 'tok-sess', deviceId: 'dev-sess' });
    const { session } = await res.json() as { session: string };
    expect(session).toBeTruthy();

    // Desde la 053 las sesiones viven en user_sessions (multi-dispositivo),
    // ya no en users.session_token. El contrato con la BD no cambia: hash.
    const row = await db.query<{ token_hash: string }>(
      `SELECT s.token_hash
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE u.device_id = 'dev-sess'`
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]!.token_hash).toBe(hash(session)); // hash, no el claro
    expect(row.rows[0]!.token_hash).not.toBe(session);
  });
});
