import { Hono } from 'hono';
import Stripe from 'stripe';
import { db } from '@sports/db';

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

stripeRouter.post('/checkout', async (c) => {
  try {
    const { deviceId } = await c.req.json<{ deviceId?: string }>();
    if (!deviceId) return c.json({ error: 'missing_device_id' }, 400);

    // Asegurar que el usuario existe (misma semántica que Redsys)
    const userRes = await db.query<{ id: string; is_premium: boolean }>(
      `INSERT INTO users (device_id) VALUES ($1)
       ON CONFLICT (device_id) DO UPDATE SET updated_at = NOW()
       RETURNING id, is_premium`,
      [deviceId]
    );
    if (userRes.rows[0]?.is_premium) {
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
