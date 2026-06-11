import { Hono } from 'hono';
import { db } from '@sports/db';

/**
 * Suscripciones Web Push.
 *
 *   POST   /push/subscribe   { subscription, deviceId, favTeams, config, locale }
 *   DELETE /push/subscribe   { endpoint }
 *
 * El cliente re-llama a subscribe cada vez que cambian sus preferencias o
 * favoritos (upsert por endpoint): la fila siempre refleja el último estado.
 * El EMISOR vive en el ETL (cron-live → push-dispatcher).
 */

export const pushRouter = new Hono();

interface SubscribeBody {
  subscription?: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  deviceId?: string;
  favTeams?: string[];
  config?: Record<string, unknown>;
  locale?: string;
}

pushRouter.post('/subscribe', async (c) => {
  try {
    const body = await c.req.json<SubscribeBody>();
    const sub = body.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return c.json({ error: 'invalid_subscription' }, 400);
    }
    const favTeams = (body.favTeams ?? []).filter((t) => /^[0-9a-f-]{36}$/i.test(t));

    await db.query(
      `INSERT INTO push_subscriptions (device_id, endpoint, p256dh, auth, fav_teams, config, locale)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (endpoint) DO UPDATE SET
         device_id = EXCLUDED.device_id,
         p256dh    = EXCLUDED.p256dh,
         auth      = EXCLUDED.auth,
         fav_teams = EXCLUDED.fav_teams,
         config    = EXCLUDED.config,
         locale    = EXCLUDED.locale,
         updated_at = NOW()`,
      [
        body.deviceId ?? 'unknown',
        sub.endpoint,
        sub.keys.p256dh,
        sub.keys.auth,
        favTeams,
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
