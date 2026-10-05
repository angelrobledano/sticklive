/**
 * Auth — login de la app móvil: código de canje single-use (Task 3.1).
 *
 * Contrato (Task 3.2 consumirá esto por el scheme sticklive://):
 *   - GET /auth/google?client=app&device=X firma un state que transporta
 *     client=app y el device; la web (sin client=app) NO lo recibe.
 *   - POST /auth/exchange canjea el código UNA sola vez por una sesión Bearer
 *     usable en GET /auth/me; el 2º canje, un código inexistente, caducado o
 *     malformado → 400. La sesión NUNCA viaja por el custom scheme.
 *
 * Router real contra Postgres; el código se siembra HASHEADO igual que hace el
 * callback de Google (mismo patrón que auth-verify.integration.test.ts).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import { createHash, randomBytes } from 'node:crypto';
import { db, closeDb } from '@sports/db';
import { authRouter } from '../../apps/api/src/routes/auth.js';
import { signState, verifyState } from '../../apps/api/src/lib/auth-state.js';
import { postgresNonceStore } from '../../apps/api/src/lib/oauth-nonce-pg.js';
import { limpiar } from './support/db.js';

const app = new Hono();
app.route('/auth', authRouter);

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

async function sembrarUsuario(deviceId: string, email: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO users (device_id, email) VALUES ($1, $2) RETURNING id`,
    [deviceId, email]
  );
  return res.rows[0]!.id;
}

async function sembrarCodigo(code: string, userId: string, secs: number): Promise<void> {
  await db.query(
    `INSERT INTO app_login_codes (code_hash, user_id, expires_at)
     VALUES ($1, $2, NOW() + make_interval(secs => $3::int))`,
    [hash(code), userId, secs]
  );
}

const exchange = (code: string) =>
  app.request('/auth/exchange', {
    method: 'POST', body: JSON.stringify({ code }),
    headers: { 'content-type': 'application/json' },
  });

beforeAll(() => {
  // /auth/google requiere cliente configurado; el state se firma con este
  // secreto y el test lo verifica con el mismo. El secreto de Google (que el
  // callback exige presente) se fija para que las pruebas del callback no
  // dependan del entorno local.
  process.env['GOOGLE_CLIENT_ID'] = 'test-client-id';
  process.env['GOOGLE_CLIENT_SECRET'] = 'test-client-secret';
  process.env['AUTH_STATE_SECRET'] = 'test-secret-integration';
});
beforeEach(async () => { await limpiar(); });
afterAll(async () => { await closeDb(); });

describe('GET /auth/google — state del cliente app', () => {
  it('con ?client=app&device=X el state firmado transporta client=app y el device', async () => {
    const res = await app.request('/auth/google?client=app&device=dev-app-1');
    expect(res.status).toBe(302);

    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth')).toBe(true);
    const state = new URL(location).searchParams.get('state') ?? '';
    const st = verifyState(state);
    expect(st).toMatchObject({ client: 'app', d: 'dev-app-1' });
    expect(st?.n).toBeTruthy();
  });

  it('la web (sin client=app, con device_id histórico) NO recibe el campo client', async () => {
    const res = await app.request('/auth/google?device_id=dev-web-1');
    expect(res.status).toBe(302);

    const state = new URL(res.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const st = verifyState(state);
    expect(st).toMatchObject({ d: 'dev-web-1' });
    expect(st && 'client' in st).toBe(false);
  });

  it('?client=web (valor distinto de app) NO activa la rama app', async () => {
    const res = await app.request('/auth/google?client=web&device_id=dev-web-2');
    expect(res.status).toBe(302);

    const state = new URL(res.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const st = verifyState(state);
    expect(st && 'client' in st).toBe(false);
  });
});

describe('POST /auth/exchange', () => {
  it('canjea un código válido UNA sola vez y la sesión funciona en /auth/me', async () => {
    const email = `app-${randomBytes(6).toString('hex')}@x.com`;
    const userId = await sembrarUsuario('dev-exchange', email);
    const code = randomBytes(24).toString('base64url');
    await sembrarCodigo(code, userId, 120);

    const res = await exchange(code);
    expect(res.status).toBe(200);
    const { session, email: devuelto } = (await res.json()) as { session: string; email: string };
    expect(session).toBeTruthy();
    expect(devuelto).toBe(email);

    // La sesión canjeada es una sesión real del sistema (Bearer).
    const me = await app.request('/auth/me', {
      headers: { Authorization: `Bearer ${session}` },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ authenticated: true, email });

    // Segundo canje del MISMO código → 400 (single-use atómico).
    const again = await exchange(code);
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: 'invalid_code' });
  });

  it('rechaza un código caducado con 400', async () => {
    const userId = await sembrarUsuario('dev-expirado', 'expirado@x.com');
    const code = randomBytes(24).toString('base64url');
    await sembrarCodigo(code, userId, -60); // caducado hace 1 min

    const res = await exchange(code);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_code' });
  });

  it('rechaza un código inexistente con 400', async () => {
    const res = await exchange(randomBytes(24).toString('base64url'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_code' });
  });

  it('rechaza un cuerpo sin código o de más de 512 caracteres con 400', async () => {
    const sinCode = await app.request('/auth/exchange', {
      method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json' },
    });
    expect(sinCode.status).toBe(400);

    const larguísimo = await exchange('a'.repeat(513));
    expect(larguísimo.status).toBe(400);
  });
});

describe('GET /auth/google/callback — fallos conscientes del cliente (Task 3.2)', () => {
  // Cuando el flujo viene de la app (state con client=app), los fallos del
  // callback deben reportarse POR EL SCHEME sticklive://auth/callback?error=…
  // para que la app los muestre en pantalla; un redirect a la web dejaría la
  // app esperando un retorno que nunca llega.
  //
  // NOTA: el fallo del INSERT del código (catch → google_error) no se simula
  // end-to-end porque requeriría romper la BD a mitad de request; la rama de
  // fail() es la misma que cubren estos dos tests.

  it('consentimiento cancelado (llega sin code, con state válido) reporta google_denied por el scheme', async () => {
    const state = signState({ d: 'dev-app-fail', n: randomBytes(8).toString('hex'), client: 'app' });
    const res = await app.request(`/auth/google/callback?state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('sticklive://auth/callback')).toBe(true);
    expect(location).toContain('error=google_denied');
  });

  it('state_reused (nonce ya consumido) también se reporta por el scheme en la rama app', async () => {
    const n = randomBytes(8).toString('hex');
    const state = signState({ d: 'dev-app-reuse', n, client: 'app' });
    // Primer consumo del nonce (el legítimo): el del callback será un reuso.
    expect(await postgresNonceStore.consume(n, new Date(Date.now() + 10 * 60_000))).toBe(true);

    const res = await app.request(`/auth/google/callback?code=x&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('sticklive://auth/callback')).toBe(true);
    expect(location).toContain('error=state_reused');
  });

  it('la rama web (state sin client) sigue reportando sus fallos a la web', async () => {
    const state = signState({ d: 'dev-web-fail', n: randomBytes(8).toString('hex') });
    const res = await app.request(`/auth/google/callback?state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('sticklive://')).toBe(false);
    expect(location).toContain('/login#error=google_denied');
  });
});
