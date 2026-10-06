/**
 * Push nativo (Expo Push → FCM/APNs) — Task 4.1.
 *
 * Contrato:
 *   - POST   /push/native/subscribe — alta/actualización del dispositivo.
 *     Upsert idempotente por expo_push_token; auth OPCIONAL con Bearer (asocia
 *     user_id); deviceId requerido; favoritos VALIDADOS como UUID antes de
 *     tocar JSONB. Decisión (review de Task 3.1, minor #3): un id inválido
 *     rechaza con 400 invalid_favorites — "los malos datos son peores que no
 *     tener datos", y un descarte silencioso haría creer al cliente que se
 *     guardó lo que no se guardó.
 *   - DELETE /push/native/subscribe — baja con ownership (deviceId que coincide
 *     O usuario de la sesión); idempotente: 200 aunque el token no exista.
 *   - POST  /push/native/opened — beacon de analítica: nunca rompe, con o sin
 *     token conocido.
 *   - POST  /push/native/test (sancionado) — notificación de prueba vía la API
 *     HTTP de Expo Push CON ownership. En tests fetch está MOCKEADO: jamás hay
 *     envíos reales desde la suite.
 *
 * Router real contra Postgres (patrón del repo); PostHog se mockea porque sin
 * POSTHOG_API_KEY el módulo real lanza al importar (comportamiento conocido).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { db, closeDb } from '@sports/db';
import { logger } from '@sports/logger';
import { pushRouter } from '../../apps/api/src/routes/push.js';
import { limpiar } from './support/db.js';

vi.mock('@sports/analytics', () => ({
  analytics: {
    capture: vi.fn(),
    flush: vi.fn(async () => {}),
  },
}));

import { analytics } from '@sports/analytics';

const app = new Hono();
app.route('/push', pushRouter);

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

const TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN2 = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
const TOKEN_AUTH = 'ExponentPushToken[cccccccccccccccccccccc]';

beforeAll(() => {
  // Sin VAPID el envío web queda deshabilitado; no afecta a los endpoints nativos.
  delete process.env['VAPID_PUBLIC_KEY'];
  delete process.env['VAPID_PRIVATE_KEY'];
  delete process.env['EXPO_ACCESS_TOKEN'];
});

beforeEach(async () => {
  await limpiar();
  vi.mocked(analytics.capture).mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  // Los spyOn (p. ej. logger.warn del test de envío fallido) no quedan colgando.
  vi.restoreAllMocks();
});
afterAll(async () => {
  await closeDb();
});

/** Siembra usuario + sesión Bearer (hash, patrón auth-exchange). */
async function sembrarSesion(deviceId: string): Promise<{ userId: string; token: string }> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO users (device_id, email) VALUES ($1, $2) RETURNING id`,
    [deviceId, `${deviceId}@x.com`]
  );
  const userId = res.rows[0]!.id;
  const token = `sess-${deviceId}`;
  await db.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + make_interval(days => 30))`,
    [userId, hash(token)]
  );
  return { userId, token };
}

const subscribe = (body: unknown, headers: Record<string, string> = {}) =>
  app.request('/push/native/subscribe', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });

const unsubscribe = (body: unknown, headers: Record<string, string> = {}) =>
  app.request('/push/native/subscribe', {
    method: 'DELETE',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });

const filasToken = (token: string) =>
  db.query<{
    user_id: string | null;
    device_id: string;
    platform: string;
    app_version: string | null;
    locale: string | null;
    fav_teams: string[];
    fav_leagues: string[];
    fav_players: string[];
    presets: Record<string, string>;
    config: Record<string, unknown>;
  }>(`SELECT user_id, device_id, platform, app_version, locale,
             fav_teams, fav_leagues, fav_players, presets, config
        FROM push_tokens WHERE expo_push_token = $1`, [token]);

describe('POST /push/native/subscribe', () => {
  it('upserta por token y la re-suscripción actualiza prefs manteniendo 1 fila', async () => {
    const body = {
      expoPushToken: TOKEN,
      deviceId: 'dev-1',
      platform: 'android',
      appVersion: '1.0.0',
      locale: 'es',
      favTeams: ['11111111-1111-1111-1111-111111111111'],
      presets: { 'team:11111111-1111-1111-1111-111111111111': 'key_events' },
      config: { master: true, quietNight: true },
    };
    const r1 = await subscribe(body);
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ ok: true });

    // Re-suscribir con prefs distintas → UPDATE (se mantiene 1 fila):
    const r2 = await subscribe({ ...body, favTeams: [], presets: {} });
    expect(r2.status).toBe(200);

    const rows = await filasToken(TOKEN);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.fav_teams).toEqual([]);
    expect(rows.rows[0]!.presets).toEqual({});
    expect(rows.rows[0]!.config).toEqual({ master: true, quietNight: true });
    expect(rows.rows[0]!.device_id).toBe('dev-1');
    expect(rows.rows[0]!.platform).toBe('android');
    expect(rows.rows[0]!.locale).toBe('es');
    // Sin sesión: el dispositivo es anónimo (user_id NULL).
    expect(rows.rows[0]!.user_id).toBeNull();
  });

  it('auth opcional: con Bearer asocia user_id; otro token sin sesión queda anónimo', async () => {
    const { userId, token: session } = await sembrarSesion('dev-auth');
    const r = await subscribe(
      { expoPushToken: TOKEN_AUTH, deviceId: 'dev-auth' },
      { Authorization: `Bearer ${session}` }
    );
    expect(r.status).toBe(200);
    const conAuth = await filasToken(TOKEN_AUTH);
    expect(conAuth.rows[0]!.user_id).toBe(userId);

    const r2 = await subscribe({ expoPushToken: TOKEN2, deviceId: 'dev-anon' });
    expect(r2.status).toBe(200);
    const sinAuth = await filasToken(TOKEN2);
    expect(sinAuth.rows[0]!.user_id).toBeNull();
  });

  it('logout: re-suscribirse SIN Bearer des-asocia el user_id (la fila refleja el último estado)', async () => {
    const { token: session } = await sembrarSesion('dev-logout');
    await subscribe(
      { expoPushToken: TOKEN, deviceId: 'dev-logout' },
      { Authorization: `Bearer ${session}` }
    );
    expect((await filasToken(TOKEN)).rows[0]!.user_id).toBeTruthy();

    // Contrato de logout: la app re-suscribe sin cabecera y el user_id se
    // limpia; al iniciar sesión volverá a asociarse con Bearer.
    await subscribe({ expoPushToken: TOKEN, deviceId: 'dev-logout' });
    expect((await filasToken(TOKEN)).rows[0]!.user_id).toBeNull();
  });

  it('rechaza un token con formato inválido con 400 invalid_token', async () => {
    const res = await subscribe({ expoPushToken: 'no-es-un-token', deviceId: 'dev-1' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_token' });
  });

  it('rechaza un token demasiado corto con 400 (hardening: [\\w-]{10,64})', async () => {
    // Los tokens reales de Expo rondan los 22 caracteres dentro del corchete.
    const res = await subscribe({ expoPushToken: 'ExponentPushToken[abc]', deviceId: 'dev-1' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_token' });
  });

  it('rechaza la ausencia de deviceId con 400 missing_device_id', async () => {
    const res = await subscribe({ expoPushToken: TOKEN });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'missing_device_id' });
  });

  it('rechaza favoritos con UUID inválido con 400 invalid_favorites y no inserta nada (decisión: fallo explícito)', async () => {
    const res = await subscribe({
      expoPushToken: TOKEN,
      deviceId: 'dev-favs',
      favTeams: ['no-es-un-uuid'],
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_favorites' });

    // "Los malos datos son peores que no tener datos": nada quedó a medias.
    const rows = await filasToken(TOKEN);
    expect(rows.rows).toHaveLength(0);
  });
});

describe('POST /push/native/subscribe — ownership del token existente (review seguridad)', () => {
  // Quien conozca un expo_push_token ajeno no puede sobrescribir la fila
  // (prefs, user_id o device): solo re-suscribe el dueño por deviceId o el
  // usuario asociado. Cada test usa su propia x-real-ip: el rate limit (30/10
  // min por ruta+IP, compartido por POST y DELETE) es en memoria y en tests no
  // hay conexión TCP, así que sin cabecera propia todos compartirían cubo.
  it('re-suscripción por el MISMO deviceId → 200: el dueño por device siempre puede (y des-asocia user_id, contrato de logout)', async () => {
    const { token: session } = await sembrarSesion('dev-dueno-a');
    await subscribe(
      { expoPushToken: TOKEN, deviceId: 'dev-a', favTeams: ['11111111-1111-1111-1111-111111111111'] },
      { Authorization: `Bearer ${session}`, 'x-real-ip': '10.1.0.1' }
    );

    // Re-suscribe el MISMO device SIN Bearer (como el logout de la app):
    const res = await subscribe(
      { expoPushToken: TOKEN, deviceId: 'dev-a', favTeams: [] },
      { 'x-real-ip': '10.1.0.1' }
    );
    expect(res.status).toBe(200);

    const fila = (await filasToken(TOKEN)).rows[0]!;
    expect(fila.device_id).toBe('dev-a');
    expect(fila.user_id).toBeNull();
    expect(fila.fav_teams).toEqual([]);
  });

  it('re-suscripción por el USUARIO dueño con Bearer → 200 y fila actualizada', async () => {
    const { userId, token: session } = await sembrarSesion('dev-dueno-b');
    await subscribe(
      { expoPushToken: TOKEN, deviceId: 'dev-b' },
      { Authorization: `Bearer ${session}`, 'x-real-ip': '10.1.0.2' }
    );

    const res = await subscribe(
      { expoPushToken: TOKEN, deviceId: 'dev-b', favTeams: ['11111111-1111-1111-1111-111111111111'] },
      { Authorization: `Bearer ${session}`, 'x-real-ip': '10.1.0.2' }
    );
    expect(res.status).toBe(200);

    const fila = (await filasToken(TOKEN)).rows[0]!;
    expect(fila.user_id).toBe(userId);
    expect(fila.fav_teams).toEqual(['11111111-1111-1111-1111-111111111111']);
  });

  it('atacante con deviceId distinto y sin sesión → 403 forbidden y la fila SIN cambios', async () => {
    await subscribe(
      {
        expoPushToken: TOKEN,
        deviceId: 'dev-victima',
        favTeams: ['11111111-1111-1111-1111-111111111111'],
        config: { master: true },
      },
      { 'x-real-ip': '10.1.0.3' }
    );

    const res = await subscribe(
      { expoPushToken: TOKEN, deviceId: 'dev-atacante', favTeams: [], config: {} },
      { 'x-real-ip': '10.1.0.3' }
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden' });

    // La fila sigue siendo de la víctima, byte a byte:
    const fila = (await filasToken(TOKEN)).rows[0]!;
    expect(fila.device_id).toBe('dev-victima');
    expect(fila.user_id).toBeNull();
    expect(fila.fav_teams).toEqual(['11111111-1111-1111-1111-111111111111']);
    expect(fila.config).toEqual({ master: true });
  });

  it('atacante con sesión de OTRO usuario → 403 y la fila SIN cambios (ni user_id ni prefs)', async () => {
    const dueno = await sembrarSesion('dev-dueno-c');
    const atacante = await sembrarSesion('dev-atacante-c');
    await subscribe(
      {
        expoPushToken: TOKEN,
        deviceId: 'dev-victima-c',
        favLeagues: ['22222222-2222-2222-2222-222222222222'],
      },
      { Authorization: `Bearer ${dueno.token}`, 'x-real-ip': '10.1.0.4' }
    );

    const res = await subscribe(
      { expoPushToken: TOKEN, deviceId: 'dev-atacante-c', favLeagues: [] },
      { Authorization: `Bearer ${atacante.token}`, 'x-real-ip': '10.1.0.4' }
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden' });

    const fila = (await filasToken(TOKEN)).rows[0]!;
    expect(fila.user_id).toBe(dueno.userId);
    expect(fila.device_id).toBe('dev-victima-c');
    expect(fila.fav_leagues).toEqual(['22222222-2222-2222-2222-222222222222']);
  });
});

describe('DELETE /push/native/subscribe', () => {
  it('baja por deviceId e idempotente (200 también si ya no existe)', async () => {
    await subscribe({ expoPushToken: TOKEN, deviceId: 'dev-1' });
    const del = await unsubscribe({ expoPushToken: TOKEN, deviceId: 'dev-1' });
    expect(del.status).toBe(200);
    expect((await filasToken(TOKEN)).rows).toHaveLength(0);

    const del2 = await unsubscribe({ expoPushToken: TOKEN, deviceId: 'dev-1' });
    expect(del2.status).toBe(200);
  });

  it('ownership: sin deviceId coincidente ni sesión NO borra el token ajeno', async () => {
    await subscribe({ expoPushToken: TOKEN, deviceId: 'dev-1' });
    const res = await unsubscribe({ expoPushToken: TOKEN, deviceId: 'dev-otro' });
    expect(res.status).toBe(200);
    // Idempotente y sin filtrar información: 200, pero la fila SIGUE.
    expect((await filasToken(TOKEN)).rows).toHaveLength(1);
  });

  it('ownership: el Bearer del dueño borra sin deviceId en el body', async () => {
    const { token: session } = await sembrarSesion('dev-auth');
    await subscribe(
      { expoPushToken: TOKEN_AUTH, deviceId: 'dev-auth' },
      { Authorization: `Bearer ${session}` }
    );
    const res = await unsubscribe(
      { expoPushToken: TOKEN_AUTH },
      { Authorization: `Bearer ${session}` }
    );
    expect(res.status).toBe(200);
    expect((await filasToken(TOKEN_AUTH)).rows).toHaveLength(0);
  });

  it('ownership: el Bearer de OTRO usuario NO borra el token ajeno', async () => {
    const dueno = await sembrarSesion('dev-dueno');
    const otro = await sembrarSesion('dev-otro-b');
    await subscribe(
      { expoPushToken: TOKEN, deviceId: 'dev-dueno' },
      { Authorization: `Bearer ${dueno.token}` }
    );
    // Sin deviceId en el body: la única vía de borrado sería el user de la
    // sesión, y no es el dueño. 200 idempotente, pero la fila SOBREVIVE.
    const res = await unsubscribe(
      { expoPushToken: TOKEN },
      { Authorization: `Bearer ${otro.token}` }
    );
    expect(res.status).toBe(200);
    expect((await filasToken(TOKEN)).rows).toHaveLength(1);
  });

  it('sin token en el body → 400 missing_token', async () => {
    const res = await unsubscribe({ deviceId: 'dev-1' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'missing_token' });
  });
});

describe('POST /push/native/opened', () => {
  it('beacon sin token responde ok igualmente', async () => {
    const res = await app.request('/push/native/opened', {
      method: 'POST',
      body: JSON.stringify({ type: 'match_goal' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('beacon con token conocido captura notification_opened con distinctId = device_id', async () => {
    await subscribe({ expoPushToken: TOKEN, deviceId: 'dev-open' });
    const res = await app.request('/push/native/opened', {
      method: 'POST',
      body: JSON.stringify({ expoPushToken: TOKEN, type: 'match_goal' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(analytics.capture).toHaveBeenCalledWith({
      distinctId: 'dev-open',
      event: 'notification_opened',
      properties: { notification_type: 'match_goal' },
    });
  });

  it('beacon con token desconocido responde ok y no captura', async () => {
    const res = await app.request('/push/native/opened', {
      method: 'POST',
      body: JSON.stringify({ expoPushToken: TOKEN, type: 'match_goal' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(analytics.capture).not.toHaveBeenCalled();
  });
});

describe('POST /push/native/test', () => {
  const mockExpoOk = () =>
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ status: 'ok', id: 'ticket-1' }] }), { status: 200 })));

  it('envía la prueba vía la API HTTP de Expo Push (fetch mockeado) → sent 1', async () => {
    await subscribe({ expoPushToken: TOKEN, deviceId: 'dev-test' });
    mockExpoOk();

    const res = await app.request('/push/native/test', {
      method: 'POST',
      body: JSON.stringify({ expoPushToken: TOKEN, deviceId: 'dev-test' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sent: 1 });

    // El envío fue a la API HTTP de Expo, con el token del body:
    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('exp.host/--/api/v2/push/send');
    expect(JSON.parse(String(init?.body))).toMatchObject({ to: TOKEN });
  });

  it('envío fallido según Expo se loguea y responde sent 0 sin romper', async () => {
    await subscribe({ expoPushToken: TOKEN, deviceId: 'dev-fail' });
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        data: [{ status: 'error', message: 'DeviceNotRegistered' }],
      }), { status: 200 })));
    const warnSpy = vi.spyOn(logger, 'warn');

    const res = await app.request('/push/native/test', {
      method: 'POST',
      body: JSON.stringify({ expoPushToken: TOKEN, deviceId: 'dev-fail' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sent: 0 });
    // Log explícito del resultado (contrato del endpoint sancionado):
    expect(warnSpy).toHaveBeenCalled();
  });

  it('ownership: el Bearer del dueño basta, con o sin deviceId en el body → sent 1', async () => {
    const { token: session } = await sembrarSesion('dev-test-auth');
    await subscribe(
      { expoPushToken: TOKEN_AUTH, deviceId: 'dev-test-auth' },
      { Authorization: `Bearer ${session}` }
    );
    mockExpoOk();

    // Sin deviceId en el body: el user de la sesión es el dueño.
    const sinDevice = await app.request('/push/native/test', {
      method: 'POST',
      body: JSON.stringify({ expoPushToken: TOKEN_AUTH }),
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${session}` },
    });
    expect(sinDevice.status).toBe(200);
    expect(await sinDevice.json()).toMatchObject({ ok: true, sent: 1 });

    // Con un deviceId DISTINTO en el body: no revierte el ownership del user.
    const otroDevice = await app.request('/push/native/test', {
      method: 'POST',
      body: JSON.stringify({ expoPushToken: TOKEN_AUTH, deviceId: 'dev-distinto' }),
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${session}` },
    });
    expect(otroDevice.status).toBe(200);
    expect(await otroDevice.json()).toMatchObject({ ok: true, sent: 1 });
  });

  it('ownership: el token de otro device sin sesión → 403 y ni intenta el envío', async () => {
    await subscribe({ expoPushToken: TOKEN, deviceId: 'dev-owner' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await app.request('/push/native/test', {
      method: 'POST',
      body: JSON.stringify({ expoPushToken: TOKEN, deviceId: 'dev-otro' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('token inexistente → 404 no_subscription', async () => {
    const res = await app.request('/push/native/test', {
      method: 'POST',
      body: JSON.stringify({ expoPushToken: TOKEN, deviceId: 'dev-x' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'no_subscription' });
  });
});
