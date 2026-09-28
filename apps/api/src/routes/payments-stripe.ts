import { Hono } from 'hono';
import Stripe from 'stripe';
import { db, withTransaction } from '@sports/db';
import { logger } from '@sports/logger';
import { rateLimit } from '../lib/rate-limit.js';
import { isPremiumActive, isCheckoutSessionId, isPaidCheckoutSession } from '../lib/premium.js';

/**
 * Pagos con Stripe — proveedor de pago ACTIVO (Redsys fue eliminado de la API:
 * no existe backend al que llamar; no volver a documentarlo sin reintroducirlo).
 *
 *   POST /payments/stripe/checkout        { deviceId } → { url } de Stripe Checkout
 *   GET  /payments/stripe/session/:id     verifica una Checkout Session (retorno)
 *   POST /payments/stripe/webhook         → checkout.session.completed activa premium
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

/**
 * GET /payments/stripe/session/:id
 * Verificación server-side del retorno de Checkout (#252): la página de éxito
 * NO debe auto-otorgarse premium solo por llegar a la URL. Aquí se confirma
 * contra Stripe que la sesión está pagada y se devuelve el entitlement.
 * El webhook sigue siendo la fuente de verdad de la BD; esto solo evita el
 * falso premium y la analítica de compra falsificada.
 */
stripeRouter.get('/session/:id', rateLimit(30, 60_000), async (c) => {
  const id = c.req.param('id');
  if (!isCheckoutSessionId(id)) return c.json({ error: 'invalid_session_id' }, 400);

  try {
    const session = await stripe().checkout.sessions.retrieve(id);
    const paid = isPaidCheckoutSession(session);

    // Si el pago está confirmado, concedemos el entitlement aunque el webhook
    // llegue con retraso. Si no, mandamos el estado autoritativo de la BD.
    let premium = paid;
    let premiumUntil: string | null = null;
    const deviceId = session.metadata?.['deviceId'];
    if (deviceId) {
      try {
        const res = await db.query<{ premium_until: string | null }>(
          `SELECT premium_until FROM users WHERE device_id = $1`, [deviceId]
        );
        const until = res.rows[0]?.premium_until ?? null;
        if (isPremiumActive(until)) {
          premium = true;
          premiumUntil = until;
        }
      } catch (dbErr) {
        // Un fallo de BD no debe tumbar el pago ya verificado con Stripe.
        logger.error({ err: dbErr }, '[stripe] session db lookup error');
      }
    }

    return c.json({ paid, premium, premiumUntil });
  } catch (err) {
    // Sesión inexistente o error de Stripe: nunca conceder premium.
    const status = (err as { statusCode?: number }).statusCode;
    logger.error({ err }, '[stripe] session lookup error');
    if (status === 404) return c.json({ error: 'session_not_found' }, 404);
    return c.json({ error: 'stripe_error' }, 502);
  }
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
            // #253: solo se anuncia el beneficio real. El resto del copy
            // (i18n) se ajusta por separado; aquí no inventamos features.
            description: 'Disfruta de Stick Live sin publicidad.',
          },
        },
      }],
      metadata: { deviceId, userId: userRes.rows[0]!.id },
      // Stripe sustituye {CHECKOUT_SESSION_ID} por el id real. La página de
      // éxito lo usa para verificar el pago server-side antes de dar premium.
      success_url: `${WEB_BASE}/premium/success?provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${WEB_BASE}/premium/error?provider=stripe`,
    });

    return c.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, '[stripe] checkout error');
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
    logger.error({ err }, '[stripe] firma de webhook inválida');
    return c.json({ error: 'invalid_signature' }, 400);
  }

  // Idempotencia + efecto en UNA transacción (#154): si el efecto falla, la marca
  // de idempotencia se revierte con él, así que el reintento de Stripe vuelve a
  // procesar el evento. Antes quedaba marcado sin aplicar → pago sin premium
  // irrecuperable.
  let duplicate = false;
  let premiumUserId: string | null = null;
  let analyticsDeviceId: string | undefined;
  let amountTotal = PRICE_CENTS;

  await withTransaction(async (tx) => {
    const seen = await tx.query(
      `INSERT INTO processed_stripe_events (event_id) VALUES ($1)
       ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [event.id]
    );
    if ((seen.rowCount ?? 0) === 0) {
      duplicate = true;
      return;
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata?.['userId'];

      if (userId) {
        // Extiende desde la caducidad previa si aún está vigente (una renovación
        // anticipada no debe perder los días que quedaban).
        await tx.query(
          `UPDATE users SET is_premium = TRUE,
                            premium_until = GREATEST(COALESCE(premium_until, NOW()), NOW()) + INTERVAL '1 year',
                            updated_at = NOW()
           WHERE id = $1`,
          [userId]
        );
        premiumUserId = userId;
        analyticsDeviceId = session.metadata?.['deviceId'];
        amountTotal = session.amount_total ?? PRICE_CENTS;
        logger.info({ userId }, '[stripe] Premium activado');
      }
    }
  });

  if (duplicate) return c.json({ received: true, duplicate: true });

  // Analítica de servidor FUERA de la transacción: no debe bloquear ni revertir
  // el efecto del pago. Cierra el funnel premium_checkout_started → purchased.
  if (premiumUserId) {
    try {
      const { analytics } = await import('@sports/analytics');
      analytics.capture({
        distinctId: analyticsDeviceId ?? premiumUserId,
        event: 'premium_purchased',
        properties: { provider: 'stripe', amount_cents: amountTotal },
      });
      await analytics.flush();
    } catch { /* sin POSTHOG_API_KEY no bloqueamos el webhook */ }
  }

  return c.json({ received: true });
});
