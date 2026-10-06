import { Hono } from 'hono';
import type { Context } from 'hono';
import webpush from 'web-push';
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import { rateLimit, rateLimitBy } from '../lib/rate-limit.js';
import { captureRouteError } from '../lib/route-error.js';
import { userFromBearer } from '../lib/session-lookup.js';
import { isUuid } from '../lib/uuid.js';
import { MAX_FAVORITES_PER_KIND } from '../lib/favorites.js';
import {
  isAllowedPushEndpoint,
  canDeleteSubscription,
  makeUnsubscribeToken,
  MAX_PUSH_SUBS_PER_DEVICE,
} from '../lib/push-security.js';

/**
 * Suscripciones Push.
 *
 *   WEB (VAPID):
 *   POST   /push/subscribe          { subscription, deviceId, favTeams, config, locale }
 *   DELETE /push/subscribe          { endpoint, deviceId|token }  → prueba de ownership
 *   POST   /push/test               { deviceId }   → envía una notificación de prueba
 *
 *   NATIVO (Expo Push → FCM/APNs, Task 4.1):
 *   POST   /push/native/subscribe   { expoPushToken, deviceId, ...prefs }  (auth opcional)
 *   DELETE /push/native/subscribe   { expoPushToken, deviceId? }           (auth opcional)
 *   POST   /push/native/opened      { expoPushToken?, type? }  → beacon analítica
 *   POST   /push/native/test        { expoPushToken, deviceId? } → prueba Expo Push
 *
 * El cliente re-llama a subscribe cada vez que cambian sus preferencias o
 * favoritos (upsert por endpoint / token): la fila siempre refleja el último
 * estado. El EMISOR de eventos reales (goles, inicio/final) vive en el ETL
 * (cron-live → push-dispatcher); aquí solo va el envío de prueba manual.
 */

// VAPID para el envío de prueba (mismas claves que el ETL, vía env_file).
const VAPID_PUBLIC  = process.env['VAPID_PUBLIC_KEY']  ?? '';
const VAPID_PRIVATE = process.env['VAPID_PRIVATE_KEY'] ?? '';
const VAPID_SUBJECT = process.env['VAPID_SUBJECT'] ?? 'mailto:robledano@gmail.com';
const pushEnabled = Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
if (pushEnabled) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

export const pushRouter = new Hono();

interface SubscribeBody {
  subscription?: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  deviceId?: string;
  favTeams?: string[];
  favLeagues?: string[];
  favPlayers?: string[];
  config?: Record<string, unknown>;
  /** Mapa "<tipo>:<id>" → preset de notificación (complete|key_events|results|silent). */
  presets?: Record<string, string>;
  locale?: string;
}

const VALID_PRESETS = new Set(['complete', 'key_events', 'results', 'silent']);
/** Filtra el mapa de presets a claves "tipo:uuid" y valores de preset válidos. */
function sanitizePresets(p?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    const m = /^(team|competition|player):([0-9a-f-]{36})$/i.exec(k);
    if (m && VALID_PRESETS.has(v)) out[k] = v;
  }
  return out;
}

const UUID_RE = /^[0-9a-f-]{36}$/i;
const onlyUuids = (xs?: string[]) => (xs ?? []).filter((x) => UUID_RE.test(x));

/** Clave de rate limit por deviceId (llega en el body; Hono lo cachea). */
const deviceKey = async (c: Context): Promise<string> => {
  try {
    const b = await c.req.json<{ deviceId?: string }>();
    return (b.deviceId ?? 'unknown').slice(0, 128);
  } catch {
    return 'unknown';
  }
};

// Rate limit anti-abuso (#333): el cliente re-suscribe al cambiar preferencias,
// así que 30/min por IP deja margen de sobra sin permitir inundar la BD.
// #305: además por deviceId, para que rotar la IP no permita inundar la tabla.
pushRouter.post(
  '/subscribe',
  rateLimit(30, 60_000),
  rateLimitBy(30, 60_000, deviceKey),
  async (c) => {
    try {
      const body = await c.req.json<SubscribeBody>();
      const sub = body.subscription;
      if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
        return c.json({ error: 'invalid_subscription' }, 400);
      }
      // #305: el endpoint lo controla el cliente y el emisor hace POST saliente.
      // Solo se aceptan push services conocidos → sin SSRF ni polución.
      if (!isAllowedPushEndpoint(sub.endpoint)) {
        return c.json({ error: 'invalid_endpoint' }, 400);
      }
      const favTeams   = onlyUuids(body.favTeams);
      const favLeagues = onlyUuids(body.favLeagues);
      const favPlayers = onlyUuids(body.favPlayers);
      const presets    = sanitizePresets(body.presets);
      const deviceId   = body.deviceId ?? 'unknown';

      await db.query(
        `INSERT INTO push_subscriptions (device_id, endpoint, p256dh, auth, fav_teams, fav_leagues, fav_players, config, presets, locale)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (endpoint) DO UPDATE SET
           device_id   = EXCLUDED.device_id,
           p256dh      = EXCLUDED.p256dh,
           auth        = EXCLUDED.auth,
           fav_teams   = EXCLUDED.fav_teams,
           fav_leagues = EXCLUDED.fav_leagues,
           fav_players = EXCLUDED.fav_players,
           config      = EXCLUDED.config,
           presets     = EXCLUDED.presets,
           locale      = EXCLUDED.locale,
           updated_at  = NOW()`,
        [
          deviceId,
          sub.endpoint,
          sub.keys.p256dh,
          sub.keys.auth,
          favTeams,
          favLeagues,
          favPlayers,
          JSON.stringify(body.config ?? {}),
          JSON.stringify(presets),
          body.locale ?? 'es',
        ]
      );

      // #305: cap por dispositivo; si se supera, fuera las más antiguas. Evita
      // que un solo device (o un atacante) acumule filas sin límite.
      await db.query(
        `DELETE FROM push_subscriptions
          WHERE device_id = $1
            AND id NOT IN (
              SELECT id FROM push_subscriptions
               WHERE device_id = $1
               ORDER BY updated_at DESC, id DESC
               LIMIT $2
            )`,
        [deviceId, MAX_PUSH_SUBS_PER_DEVICE]
      );

      // El token de baja permite borrar sin exponer el deviceId (propuesta para
      // el cliente; hoy el DELETE acepta también el deviceId) (#305).
      return c.json({ ok: true, unsubscribeToken: makeUnsubscribeToken(deviceId, sub.endpoint) });
    } catch (err) {
      captureRouteError(err, 'push] subscribe error');
      logger.error({ err }, '[push] subscribe error');
      return c.json({ error: 'server_error' }, 500);
    }
  }
);

pushRouter.delete('/subscribe', rateLimit(30, 60_000), async (c) => {
  try {
    const { endpoint, deviceId, token } = await c.req.json<{
      endpoint?: string;
      deviceId?: string;
      token?: string;
    }>();
    if (!endpoint) return c.json({ error: 'missing_endpoint' }, 400);

    // #305: prueba de ownership. Si conociéramos la fila ajena bastaría el
    // endpoint, así que solo se borra si el deviceId coincide o el token de baja
    // es válido. Si el endpoint no existe, ok idempotente (sin filtrar nada).
    const found = await db.query<{ device_id: string; endpoint: string }>(
      `SELECT device_id, endpoint FROM push_subscriptions WHERE endpoint = $1`,
      [endpoint]
    );
    const row = found.rows[0];
    if (row && !canDeleteSubscription(
      { deviceId: row.device_id, endpoint: row.endpoint },
      { deviceId, token }
    )) {
      return c.json({ error: 'forbidden' }, 403);
    }
    if (row) {
      await db.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
    }
    return c.json({ ok: true });
  } catch (err) {
    captureRouteError(err, 'push] unsubscribe error');
    logger.error({ err }, '[push] unsubscribe error');
    return c.json({ error: 'server_error' }, 500);
  }
});

/**
 * Analítica de apertura (server-side): emite `notification_opened` a PostHog.
 * Fire-and-forget: sin POSTHOG_API_KEY el módulo lanza al importar y se ignora
 * — la apertura NUNCA se rompe por analítica. Compartido por /push/opened
 * (web) y /push/native/opened (app).
 */
async function captureOpened(
  distinctId: string,
  properties: { notification_type: string; url?: string }
): Promise<void> {
  try {
    const { analytics } = await import('@sports/analytics');
    analytics.capture({ distinctId, event: 'notification_opened', properties });
    await analytics.flush();
  } catch { /* sin POSTHOG_API_KEY no rompemos la apertura */ }
}

/**
 * POST /push/opened  { endpoint, type, url }
 * Beacon del service worker al abrir una notificación. Emite `notification_opened`
 * a PostHog (server-side); el distinctId se deriva del device_id de la suscripción.
 * Sin red en el SW se pierde (aceptable). Rate limit suave anti-abuso.
 */
pushRouter.post('/opened', rateLimit(120, 60_000), async (c) => {
  try {
    const { endpoint, type, url } = await c.req.json<{ endpoint?: string; type?: string; url?: string }>();
    let deviceId = 'unknown';
    if (endpoint) {
      const r = await db.query<{ device_id: string }>(
        `SELECT device_id FROM push_subscriptions WHERE endpoint = $1`, [endpoint]
      );
      deviceId = r.rows[0]?.device_id ?? 'unknown';
    }
    await captureOpened(deviceId, { notification_type: type ?? 'unknown', url: url ?? '/' });
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false }, 200); // nunca un error de analítica molesta al cliente
  }
});

/**
 * POST /push/test  { deviceId }
 * Envía una notificación de prueba a TODAS las suscripciones del dispositivo.
 * Sirve para verificar el flujo end-to-end en cada plataforma sin esperar a un
 * gol real. Rate limit estricto para evitar abuso.
 */
pushRouter.post(
  '/test',
  rateLimit(10, 10 * 60_000),
  // #305: además por deviceId, para que rotar la IP no permita spamear pruebas
  // a un dispositivo conocido (su deviceId está en localStorage/PostHog).
  rateLimitBy(10, 10 * 60_000, deviceKey),
  async (c) => {
    if (!pushEnabled) return c.json({ error: 'push_not_configured' }, 503);
    try {
      const { deviceId } = await c.req.json<{ deviceId?: string }>();
      if (!deviceId) return c.json({ error: 'missing_device' }, 400);

      const subs = await db.query<{ endpoint: string; p256dh: string; auth: string }>(
        `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE device_id = $1`,
        [deviceId]
      );
      if (subs.rows.length === 0) return c.json({ error: 'no_subscription', sent: 0 }, 404);

      const payload = JSON.stringify({
        title: 'Stick Live',
        body: '¡Notificaciones activadas! Esto es una prueba ✓',
        tag: 'sticklive-test',
        url: '/',
      });

      let sent = 0;
      for (const s of subs.rows) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          );
          sent++;
        } catch (err) {
          // 404/410 → la suscripción ya no es válida: la limpiamos.
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await db.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [s.endpoint]);
          }
        }
      }
      return c.json({ ok: true, sent });
    } catch (err) {
      captureRouteError(err, 'push] test error');
      logger.error({ err }, '[push] test error');
      return c.json({ error: 'server_error' }, 500);
    }
  }
);

// ── Push nativo (Expo Push → FCM/APNs) ───────────────────────────────────────

// Hardening: los tokens reales de Expo rondan los ~22 caracteres dentro del
// corchete; acotamos la longitud ([\w-]{10,64}) para no dar entrada libre a
// basura en una columna UNIQUE.
const EXPO_TOKEN_RE = /^ExponentPushToken\[[\w-]{10,64}\]$/;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface NativeSubBody {
  expoPushToken?: string;
  deviceId?: string;
  platform?: string;
  appVersion?: string;
  locale?: string;
  favTeams?: string[];
  favLeagues?: string[];
  favPlayers?: string[];
  /** Mapa "<tipo>:<id>" → preset de notificación (igual que la web). */
  presets?: Record<string, string>;
  config?: Record<string, unknown>;
}

/**
 * Validación ESTRICTA de favoritos para el push nativo (review de Task 3.1,
 * minor #3). JSONB no valida nada: un id que no es UUID se persistiría "bien"
 * y la segmentación del emisor jamás casaría con nada — datos malos guardados
 * como buenos. Decisión (fallo explícito > descarte silencioso, convención del
 * repo): UN solo id inválido rechaza la petición con 400 invalid_favorites,
 * para que el cliente sepa que NO se guardó nada y corrija su estado local.
 * (El endpoint web mantiene su descarte silencioso histórico: no se toca.)
 *
 * El tope de 200/kind es el mismo recorte defensivo de buildFavoritePairs
 * (MAX_FAVORITES_PER_KIND en lib/favorites.ts), no un error de datos.
 *
 * Devuelve el array validado (recortado al tope) o null si alguno no es UUID
 * (o el campo no es un array).
 */
function validateFavList(xs: unknown): string[] | null {
  if (xs === undefined || xs === null) return [];
  if (!Array.isArray(xs)) return null;
  const out: string[] = [];
  for (const id of xs.slice(0, MAX_FAVORITES_PER_KIND)) {
    if (!isUuid(id)) return null;
    out.push(id);
  }
  return out;
}

/**
 * Recorta los campos de texto libres del cliente antes del INSERT: JSONB no
 * valida y un deviceId de 10 KB no aporta nada (hincha filas, índices y logs).
 * Topes: deviceId 128 (mismo tope que deviceKey del rate limit), platform y
 * appVersion 32, locale 16 (un BCP-47 cabe de sobra). Trim de extremos:
 * un campo de espacios se trata como ausente.
 */
const clip = (s: string | undefined, max: number): string | null => {
  const t = s?.trim();
  return t ? t.slice(0, max) : null;
};

/**
 * POST /push/native/subscribe
 * Registra/actualiza el dispositivo nativo. Upsert idempotente por
 * expo_push_token: la fila siempre refleja el último estado del cliente.
 * Auth OPCIONAL con Bearer: con sesión, el token queda asociado al usuario
 * (segmentación por cuenta y borrado cross-dispositivo); sin ella, el
 * deviceId hace de owner. Re-suscribirse sin sesión des-asocia el usuario
 * (la fila refleja el último estado, igual que la web).
 *
 * Ownership del token EXISTENTE (review de seguridad): re-suscribir un token
 * que ya tiene fila exige ser su dueño — mismo deviceId o usuario asociado —;
 * si no, 403 sin tocar la fila. Quien conozca un expo_push_token ajeno no
 * puede sobrescribirle prefs, user_id ni device (DELETE y /native/test ya
 * verificaban; subscribe no). Un token NUEVO no tiene nada que proteger: el
 * INSERT no cambia. El dueño por deviceId SIEMPRE puede (contrato de logout:
 * re-suscribir sin Bearer des-asocia el user_id).
 *
 * El tope de suscripciones por dispositivo de la web (MAX_PUSH_SUBS_PER_DEVICE,
 * #305) NO aplica aquí: push_tokens tiene una fila por token (el upsert no
 * acumula filas), y la poda de tokens muertos es cosa del dispatcher del ETL.
 */
pushRouter.post(
  '/native/subscribe',
  rateLimit(30, 10 * 60_000),
  // Paridad #305 con la web: además por deviceId, para que rotar la IP no
  // permita inundar la tabla (el deviceId llega en el body).
  rateLimitBy(30, 10 * 60_000, deviceKey),
  async (c) => {
    try {
      const body = await c.req.json<NativeSubBody>().catch((): NativeSubBody => ({}));
      if (!body.expoPushToken || !EXPO_TOKEN_RE.test(body.expoPushToken)) {
        return c.json({ error: 'invalid_token' }, 400);
      }
      // Recortado a 128 y sin espacios-fantasma: un deviceId vacío es un
      // missing_device_id, no una fila basura (NOT NULL con 'unknown').
      const deviceId = clip(body.deviceId, 128);
      if (!deviceId) return c.json({ error: 'missing_device_id' }, 400);

      const favTeams   = validateFavList(body.favTeams);
      const favLeagues = validateFavList(body.favLeagues);
      const favPlayers = validateFavList(body.favPlayers);
      if (favTeams === null || favLeagues === null || favPlayers === null) {
        return c.json({ error: 'invalid_favorites' }, 400);
      }
      const presets = sanitizePresets(body.presets);

      const user = await userFromBearer(c.req.header('Authorization'));

      // Ownership del token EXISTENTE (review de seguridad): solo re-suscribe
      // el dueño por deviceId o el usuario asociado a la fila; si no, 403 sin
      // tocarla. El deviceId se compara CLIPADO (igual que se almacenó) y el
      // user de la sesión contra el user_id de la fila. Un token nuevo no tiene
      // nada que proteger: si no hay fila, se sigue directo al INSERT.
      const existing = await db.query<{ device_id: string; user_id: string | null }>(
        `SELECT device_id, user_id FROM push_tokens WHERE expo_push_token = $1`,
        [body.expoPushToken]
      );
      const fila = existing.rows[0];
      if (fila && fila.device_id !== deviceId && (user === null || fila.user_id !== user.id)) {
        return c.json({ error: 'forbidden' }, 403);
      }

      // Cinturón y tirantes (misma regla que el SELECT de arriba): si entre el
      // SELECT y este upsert la fila apareciera por otra petición concurrente,
      // el WHERE del DO UPDATE impide pisarla — el UPDATE no se aplica y el
      // cliente legítimo no nota nada (siempre casa su propia device/user).
      await db.query(
        `INSERT INTO push_tokens
           (expo_push_token, user_id, device_id, platform, app_version, locale,
            fav_teams, fav_leagues, fav_players, presets, config)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb)
         ON CONFLICT (expo_push_token) DO UPDATE SET
           user_id     = EXCLUDED.user_id,
           device_id   = EXCLUDED.device_id,
           platform    = EXCLUDED.platform,
           app_version = EXCLUDED.app_version,
           locale      = EXCLUDED.locale,
           fav_teams   = EXCLUDED.fav_teams,
           fav_leagues = EXCLUDED.fav_leagues,
           fav_players = EXCLUDED.fav_players,
           presets     = EXCLUDED.presets,
           config      = EXCLUDED.config,
           updated_at  = NOW()
         WHERE push_tokens.device_id = EXCLUDED.device_id
            OR push_tokens.user_id = EXCLUDED.user_id`,
        [
          body.expoPushToken,
          user?.id ?? null,
          deviceId,
          clip(body.platform, 32) ?? 'android',
          clip(body.appVersion, 32),
          clip(body.locale, 16),
          JSON.stringify(favTeams),
          JSON.stringify(favLeagues),
          JSON.stringify(favPlayers),
          JSON.stringify(presets),
          JSON.stringify(body.config ?? {}),
        ]
      );
      return c.json({ ok: true });
    } catch (err) {
      captureRouteError(err, 'push] native subscribe error');
      logger.error({ err }, '[push] native subscribe error');
      return c.json({ error: 'server_error' }, 500);
    }
  }
);

/**
 * DELETE /push/native/subscribe  { expoPushToken, deviceId? }  (auth opcional)
 * Baja con ownership: solo se borra si el deviceId coincide o el token
 * pertenece al usuario de la sesión. Si no, la fila sobrevive y la respuesta
 * es idéntica (200): no se filtra la existencia del token. Idempotente.
 */
pushRouter.delete('/native/subscribe', rateLimit(30, 10 * 60_000), async (c) => {
  try {
    const body = await c.req.json<NativeSubBody>().catch((): NativeSubBody => ({}));
    if (!body.expoPushToken) return c.json({ error: 'missing_token' }, 400);

    const user = await userFromBearer(c.req.header('Authorization'));
    // Mismo recorte que en el subscribe: el deviceId se compara con el que se
    // almacenó (recortado), si no el ownership fallaría en el borde con
    // espacios. undefined/espacios → null → esa rama del OR no aplica.
    await db.query(
      `DELETE FROM push_tokens
        WHERE expo_push_token = $1
          AND ($2::text IS NOT NULL AND device_id = $2
               OR $3::uuid IS NOT NULL AND user_id = $3)`,
      [body.expoPushToken, clip(body.deviceId, 128), user?.id ?? null]
    );
    return c.json({ ok: true }); // idempotente: borrar lo inexistente es ok
  } catch (err) {
    captureRouteError(err, 'push] native unsubscribe error');
    logger.error({ err }, '[push] native unsubscribe error');
    return c.json({ error: 'server_error' }, 500);
  }
});

/**
 * POST /push/native/opened  { expoPushToken?, type? }
 * Beacon de la app al abrir una notificación. Resuelve el device_id por token
 * y emite `notification_opened` con el MISMO patrón que /push/opened (web).
 * Con token desconocido o ausente responde ok igualmente: es un beacon, nunca
 * debe molestar al cliente.
 */
pushRouter.post('/native/opened', rateLimit(120, 60_000), async (c) => {
  try {
    const body = await c.req
      .json<{ expoPushToken?: string; type?: string }>()
      .catch((): { expoPushToken?: string; type?: string } => ({}));
    let deviceId: string | null = null;
    if (body.expoPushToken) {
      const r = await db.query<{ device_id: string }>(
        `SELECT device_id FROM push_tokens WHERE expo_push_token = $1`,
        [body.expoPushToken]
      );
      deviceId = r.rows[0]?.device_id ?? null;
    }
    if (deviceId) {
      await captureOpened(deviceId, { notification_type: body.type ?? 'unknown' });
    }
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false }, 200); // beacon: nunca un error de analítica molesta
  }
});

interface ExpoDelivery {
  status: 'ok' | 'error' | 'request_error';
  message?: string;
}

/**
 * Envía una notificación a un token vía la API HTTP v2 de Expo Push.
 * NUNCA lanza: el resultado (con el mensaje de Expo si lo hay) vuelve al
 * llamador para loguearse explícitamente. Sin EXPO_ACCESS_TOKEN Expo admite
 * envíos con límites propios (suficiente para la prueba manual).
 */
async function sendExpoPush(token: string, title: string, body: string): Promise<ExpoDelivery> {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env['EXPO_ACCESS_TOKEN']
          ? { Authorization: `Bearer ${process.env['EXPO_ACCESS_TOKEN']}` }
          : {}),
      },
      body: JSON.stringify({ to: token, title, body, sound: 'default' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { status: 'request_error', message: `http_${res.status}` };
    const payload = (await res.json()) as {
      data?: { status?: string; message?: string }[];
      errors?: { message?: string }[];
    };
    const receipt = payload.data?.[0];
    if (receipt?.status === 'ok') return { status: 'ok' };
    if (receipt) return { status: 'error', message: receipt.message ?? 'unknown' };
    return { status: 'request_error', message: payload.errors?.[0]?.message ?? 'unknown' };
  } catch (err) {
    return { status: 'request_error', message: (err as Error)?.message ?? 'fetch_failed' };
  }
}

/**
 * POST /push/native/test  { expoPushToken, deviceId? }   (sancionado, Task 4.1)
 * Notificación de prueba vía Expo Push para verificar el flujo end-to-end en
 * la app sin esperar a un gol real — mismo espíritu que /push/test (web).
 * CON ownership: el token debe pertenecer al deviceId del body o al usuario de
 * la sesión; conocer un token ajeno no permite enviarle pushes. Rate limit
 * estricto (10/10 min, como la web) y por deviceId. El resultado del envío se
 * loguea SIEMPRE de forma explícita.
 */
pushRouter.post(
  '/native/test',
  rateLimit(10, 10 * 60_000),
  rateLimitBy(10, 10 * 60_000, deviceKey),
  async (c) => {
    try {
      const body = await c.req
        .json<{ expoPushToken?: string; deviceId?: string }>()
        .catch((): { expoPushToken?: string; deviceId?: string } => ({}));
      if (!body.expoPushToken || !EXPO_TOKEN_RE.test(body.expoPushToken)) {
        return c.json({ error: 'invalid_token' }, 400);
      }

      const user = await userFromBearer(c.req.header('Authorization'));
      const found = await db.query<{ device_id: string; user_id: string | null }>(
        `SELECT device_id, user_id FROM push_tokens WHERE expo_push_token = $1`,
        [body.expoPushToken]
      );
      const row = found.rows[0];
      if (!row) return c.json({ error: 'no_subscription', sent: 0 }, 404);
      const owned =
        (body.deviceId !== undefined && row.device_id === body.deviceId) ||
        (user !== null && row.user_id === user.id);
      if (!owned) return c.json({ error: 'forbidden' }, 403);

      const delivery = await sendExpoPush(
        body.expoPushToken,
        'Stick Live',
        '¡Notificaciones activadas! Esto es una prueba ✓'
      );
      if (delivery.status === 'ok') {
        logger.info({ status: delivery.status }, '[push] native test enviado');
      } else {
        logger.warn(
          { status: delivery.status, message: delivery.message },
          '[push] native test fallido'
        );
      }
      return c.json({ ok: true, sent: delivery.status === 'ok' ? 1 : 0 });
    } catch (err) {
      captureRouteError(err, 'push] native test error');
      logger.error({ err }, '[push] native test error');
      return c.json({ error: 'server_error' }, 500);
    }
  }
);
