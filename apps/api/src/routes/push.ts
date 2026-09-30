import { Hono } from 'hono';
import type { Context } from 'hono';
import webpush from 'web-push';
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import { rateLimit, rateLimitBy } from '../lib/rate-limit.js';
import { captureRouteError } from '../lib/route-error.js';
import {
  isAllowedPushEndpoint,
  canDeleteSubscription,
  makeUnsubscribeToken,
  MAX_PUSH_SUBS_PER_DEVICE,
} from '../lib/push-security.js';

/**
 * Suscripciones Web Push.
 *
 *   POST   /push/subscribe   { subscription, deviceId, favTeams, config, locale }
 *   DELETE /push/subscribe   { endpoint, deviceId|token }  → prueba de ownership
 *   POST   /push/test        { deviceId }   → envía una notificación de prueba
 *
 * El cliente re-llama a subscribe cada vez que cambian sus preferencias o
 * favoritos (upsert por endpoint): la fila siempre refleja el último estado.
 * El EMISOR de eventos reales (goles, inicio/final) vive en el ETL
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
    try {
      const { analytics } = await import('@sports/analytics');
      analytics.capture({
        distinctId: deviceId,
        event: 'notification_opened',
        properties: { notification_type: type ?? 'unknown', url: url ?? '/' },
      });
      await analytics.flush();
    } catch { /* sin POSTHOG_API_KEY no rompemos la apertura */ }
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
