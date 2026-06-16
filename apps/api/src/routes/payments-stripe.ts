import { Hono } from 'hono';
import Stripe from 'stripe';
import { db } from '@sports/db';
import { rateLimit } from '../lib/rate-limit.js';
import { isPremiumActive } from '../lib/premium.js';

/**
 * Pagos con Stripe — proveedor de pago ACTIVO.
 * (Redsys queda implementado en payments.ts por si se vuelve a él:
 *  el frontend elige proveedor vía NEXT_PUBLIC_PAYMENT_PROVIDER.)
 *
 *   POST /payments/stripe/checkout  { deviceId } → { url } de Stripe Checkout
 *   POST /payments/stripe/webhook   → checkout.session.completed activa premium
 */

export const stripeRouter = new Hono();

const PRICE_CENTS = Number(process.env['PREMIUM_PRICE_EUR_CENTS'] ?? 499);
const WEB_BASE = process.env['WEB_BASE_URL'] ?? 'http://localhost:3001';

let _stripe: Stripe | null = null;
function stripe(): Stripe {
  const key = process.env['STRIPE_SECRET_KEY'];
  if (!key) throw new Error('STRIPE_SECRET_KEY no configurada');
  return (_stripe ??= new Stripe(key));
}

/**
 * GET /payments/stripe/status?deviceId=...
 * Estado premium AUTORITATIVO derivado de premium_until > NOW() (auditoría S9).
 * La web lo usa para que el premium caduque de verdad en el cliente.
 */
stripeRouter.get('/status', async (c) => {
  const deviceId = c.req.query('deviceId');
  if (!deviceId) return c.json({ error: 'missing_device_id' }, 400);
  const res = await db.query<{ premium_until: string | null }>(
    `SELECT premium_until FROM users WHERE device_id = $1`, [deviceId]
  );
  const until = res.rows[0]?.premium_until ?? null;
  const premium = isPremiumActive(until);
  return c.json({ premium, premiumUntil: premium ? until : null });
});

stripeRouter.post('/checkout', rateLimit(10, 60_000), async (c) => {
  try {
    const { deviceId } = await c.req.json<{ deviceId?: string }>();
    if (!deviceId) return c.json({ error: 'missing_device_id' }, 400);

    // Asegurar que el usuario existe (misma semántica que Redsys)
    const userRes = await db.query<{ id: string; premium_until: string | null }>(
      `INSERT INTO users (device_id) VALUES ($1)
       ON CONFLICT (device_id) DO UPDATE SET updated_at = NOW()
       RETURNING id, premium_until`,
      [deviceId]
    );
    // Premium activo = premium_until en el futuro (no el flag is_premium, que
    // nunca se revierte). Así un usuario con premium caducado puede re-comprar.
    if (isPremiumActive(userRes.rows[0]?.premium_until)) {
      return c.json({ error: 'already_premium' }, 409);
    }

    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: PRICE_CENTS,
          product_data: {
            name: 'Stick Live Premium — 1 año',
            description: 'Sin publicidad, notificaciones ilimitadas y acceso anticipado.',
          },
        },
      }],
      metadata: { deviceId, userId: userRes.rows[0]!.id },
      success_url: `${WEB_BASE}/premium/success?provider=stripe`,
      cancel_url: `${WEB_BASE}/premium/error?provider=stripe`,
    });

    return c.json({ url: session.url });
  } catch (err) {
    console.error('[stripe] checkout error:', err);
    return c.json({ error: 'server_error' }, 500);
  }
});

stripeRouter.post('/webhook', async (c) => {
  const whSecret = process.env['STRIPE_WEBHOOK_SECRET'];
  if (!whSecret) return c.json({ error: 'webhook_not_configured' }, 503);

  let event: Stripe.Event;
  try {
    // La verificación de firma exige el body CRUDO
    const rawBody = await c.req.text();
    const signature = c.req.header('stripe-signature') ?? '';
    event = await stripe().webhooks.constructEventAsync(rawBody, signature, whSecret);
  } catch (err) {
    console.error('[stripe] firma de webhook inválida:', err);
    return c.json({ error: 'invalid_signature' }, 400);
  }

  // Idempotencia (auditoría S9): si el event.id ya se procesó, no repetir el
  // efecto. INSERT ... ON CONFLICT DO NOTHING → si no inserta, es duplicado.
  const seen = await db.query(
    `INSERT INTO processed_stripe_events (event_id) VALUES ($1)
     ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
    [event.id]
  );
  if ((seen.rowCount ?? 0) === 0) {
    return c.json({ received: true, duplicate: true });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.['userId'];
    const deviceId = session.metadata?.['deviceId'];

    if (userId) {
      await db.query(
        `UPDATE users SET is_premium = TRUE,
                          premium_until = NOW() + INTERVAL '1 year',
                          updated_at = NOW()
         WHERE id = $1`,
        [userId]
      );
      console.log(`[stripe] ✅ Premium activado para user ${userId}`);

      // Analítica de servidor: cierra el funnel premium_checkout_started → purchased
      try {
        const { analytics } = await import('@sports/analytics');
        analytics.capture({
          distinctId: deviceId ?? userId,
          event: 'premium_purchased',
          properties: { provider: 'stripe', amount_cents: session.amount_total ?? PRICE_CENTS },
        });
        await analytics.flush();
      } catch { /* sin POSTHOG_API_KEY no bloqueamos el webhook */ }
    }
  }

  return c.json({ received: true });
});
