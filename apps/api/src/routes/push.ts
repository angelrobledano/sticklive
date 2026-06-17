import { Hono } from 'hono';
import webpush from 'web-push';
import { db } from '@sports/db';
import { rateLimit } from '../lib/rate-limit.js';

/**
 * Suscripciones Web Push.
 *
 *   POST   /push/subscribe   { subscription, deviceId, favTeams, config, locale }
 *   DELETE /push/subscribe   { endpoint }
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
  locale?: string;
}

const UUID_RE = /^[0-9a-f-]{36}$/i;
const onlyUuids = (xs?: string[]) => (xs ?? []).filter((x) => UUID_RE.test(x));

pushRouter.post('/subscribe', async (c) => {
  try {
    const body = await c.req.json<SubscribeBody>();
    const sub = body.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return c.json({ error: 'invalid_subscription' }, 400);
    }
    const favTeams   = onlyUuids(body.favTeams);
    const favLeagues = onlyUuids(body.favLeagues);
    const favPlayers = onlyUuids(body.favPlayers);

    await db.query(
      `INSERT INTO push_subscriptions (device_id, endpoint, p256dh, auth, fav_teams, fav_leagues, fav_players, config, locale)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (endpoint) DO UPDATE SET
         device_id   = EXCLUDED.device_id,
         p256dh      = EXCLUDED.p256dh,
         auth        = EXCLUDED.auth,
         fav_teams   = EXCLUDED.fav_teams,
         fav_leagues = EXCLUDED.fav_leagues,
         fav_players = EXCLUDED.fav_players,
         config      = EXCLUDED.config,
         locale      = EXCLUDED.locale,
         updated_at  = NOW()`,
      [
        body.deviceId ?? 'unknown',
        sub.endpoint,
        sub.keys.p256dh,
        sub.keys.auth,
        favTeams,
        favLeagues,
        favPlayers,
        JSON.stringify(body.config ?? {}),
        body.locale ?? 'es',
      ]
    );
    return c.json({ ok: true });
  } catch (err) {
    console.error('[push] subscribe error:', err);
    return c.json({ error: 'server_error' }, 500);
  }
});

pushRouter.delete('/subscribe', async (c) => {
  try {
    const { endpoint } = await c.req.json<{ endpoint?: string }>();
    if (!endpoint) return c.json({ error: 'missing_endpoint' }, 400);
    await db.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
    return c.json({ ok: true });
  } catch (err) {
    console.error('[push] unsubscribe error:', err);
    return c.json({ error: 'server_error' }, 500);
  }
});

/**
 * POST /push/test  { deviceId }
 * Envía una notificación de prueba a TODAS las suscripciones del dispositivo.
 * Sirve para verificar el flujo end-to-end en cada plataforma sin esperar a un
 * gol real. Rate limit estricto para evitar abuso.
 */
pushRouter.post('/test', rateLimit(10, 10 * 60_000), async (c) => {
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
    console.error('[push] test error:', err);
    return c.json({ error: 'server_error' }, 500);
  }
});
