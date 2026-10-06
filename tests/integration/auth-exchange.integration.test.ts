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
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
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

async function sembrarCodigo(
  code: string,
  userId: string,
  secs: number,
  deviceHash?: string
): Promise<void> {
  await db.query(
    `INSERT INTO app_login_codes (code_hash, user_id, device_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(secs => $4::int))`,
    [hash(code), userId, deviceHash ?? null, secs]
  );
}

const exchange = (code: string, deviceId?: string, ip?: string) =>
  app.request('/auth/exchange', {
    method: 'POST',
    // JSON.stringify suelta las claves undefined: sin deviceId el body no la lleva.
    body: JSON.stringify({ code, deviceId }),
    headers: {
      'content-type': 'application/json',
      // IP propia por test cuando hace falta: el rate limit (10/10 min por
      // ruta+IP) es en memoria y en tests no hay conexión TCP (clientIp cae a
      // x-real-ip), así que sin ella todos los tests comparten cubo.
      ...(ip ? { 'x-real-ip': ip } : {}),
    },
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

describe('POST /auth/exchange — binding del código al deviceId (migración 068)', () => {
  // El código viaja por el scheme sticklive:// y otra app del dispositivo puede
  // interceptarlo: desde el despliegue de 068 el callback lo emite ligado al
  // deviceId que inició el login (device_hash) y el canje solo prospera con el
  // mismo deviceId. Un intento fallido NO consume el código: sigue vivo para su
  // dueño hasta caducar (120 s).
  it('canje con el deviceId del código → 200 y la sesión funciona; con otro deviceId → 400 SIN consumir', async () => {
    const userId = await sembrarUsuario('dev-bind', 'bind@x.com');
    const code = randomBytes(24).toString('base64url');
    await sembrarCodigo(code, userId, 120, hash('dev-bind'));

    // Atacante (otra app del dispositivo, otro deviceId): 400, sin filtrar motivo.
    const atacante = await exchange(code, 'dev-atacante', '10.0.0.1');
    expect(atacante.status).toBe(400);
    expect(await atacante.json()).toMatchObject({ error: 'invalid_code' });

    // El dueño legítimo canjea después: la fila NO quedó consumida.
    const dueño = await exchange(code, 'dev-bind', '10.0.0.1');
    expect(dueño.status).toBe(200);
    const { session } = (await dueño.json()) as { session: string };
    expect(session).toBeTruthy();

    const me = await app.request('/auth/me', {
      headers: { Authorization: `Bearer ${session}` },
    });
    expect(me.status).toBe(200);
  });

  it('sin deviceId cuando la fila trae device_hash → 400 (y la fila sigue viva para el dueño)', async () => {
    const userId = await sembrarUsuario('dev-sin-device', 'sin-device@x.com');
    const code = randomBytes(24).toString('base64url');
    await sembrarCodigo(code, userId, 120, hash('dev-sin-device'));

    const res = await exchange(code, undefined, '10.0.0.2');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_code' });

    // El código NO se gastó: el dueño canjea con su deviceId.
    const dueño = await exchange(code, 'dev-sin-device', '10.0.0.2');
    expect(dueño.status).toBe(200);
  });

  it('fila legado sin device_hash (previa al despliegue) canjea normal sin deviceId', async () => {
    const userId = await sembrarUsuario('dev-legacy', 'legacy@x.com');
    const code = randomBytes(24).toString('base64url');
    await sembrarCodigo(code, userId, 120); // sin device_hash

    const res = await exchange(code, undefined, '10.0.0.3');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { session: string }).session).toBeTruthy();
  });

  it('deviceId vacío cuenta como ausente → 400 con device_hash presente', async () => {
    const userId = await sembrarUsuario('dev-vacio', 'vacio@x.com');
    const code = randomBytes(24).toString('base64url');
    await sembrarCodigo(code, userId, 120, hash('dev-vacio'));

    const res = await exchange(code, '', '10.0.0.4');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_code' });
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

describe('GET /auth/google/callback — código ligado al deviceId (migración 068)', () => {
  /** Stub del token endpoint de Google: id_token firmado no se verifica aquí (el
   *  token llega por TLS desde Google), solo aud/email_verified. */
  const mockGoogle = (email: string) =>
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(
        JSON.stringify({
          id_token: `h.${Buffer.from(
            JSON.stringify({ aud: 'test-client-id', email, email_verified: true })
          ).toString('base64url')}.s`,
        }),
        { status: 200 }
      )
    ));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('client=app SIN device en el state → app_device_required y NO se emite código', async () => {
    const state = signState({ n: randomBytes(8).toString('hex'), client: 'app' });
    const res = await app.request(
      `/auth/google/callback?code=google-code&state=${encodeURIComponent(state)}`
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('sticklive://auth/callback')).toBe(true);
    expect(location).toContain('error=app_device_required');

    // Sin device no hay código pendiente que canjear.
    const pendientes = await db.query('SELECT 1 FROM app_login_codes');
    expect(pendientes.rows).toHaveLength(0);
  });

  it('client=app con device emite el código LIGADO al device (device_hash) y solo canjea con ese deviceId', async () => {
    mockGoogle('app-bind@x.com');
    const state = signState({
      d: 'dev-e2e',
      n: randomBytes(8).toString('hex'),
      client: 'app',
    });
    const res = await app.request(
      `/auth/google/callback?code=google-code&state=${encodeURIComponent(state)}`
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('sticklive://auth/callback?code=')).toBe(true);

    // La fila quedó ligada al device que inició el login (hash SHA-256):
    const filas = await db.query<{ device_hash: string | null }>(
      'SELECT device_hash FROM app_login_codes'
    );
    expect(filas.rows).toHaveLength(1);
    expect(filas.rows[0]!.device_hash).toBe(hash('dev-e2e'));

    // La app canjea con SU deviceId → 200:
    const appCode = new URL(location).searchParams.get('code')!;
    const ok = await exchange(appCode, 'dev-e2e', '10.0.0.5');
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { email: string | null }).email).toBe('app-bind@x.com');

    // (el single-use del canje ya lo cubre el describe de /auth/exchange)
  });
});
