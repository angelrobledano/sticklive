import { Hono } from 'hono';
import Stripe from 'stripe';
import { db, withTransaction } from '@sports/db';
import { logger } from '@sports/logger';
import { rateLimit } from '../lib/rate-limit.js';
import { captureRouteError } from '../lib/route-error.js';
import { isPremiumActive, isCheckoutSessionId, isPaidCheckoutSession, isUserPremium } from '../lib/premium.js';

/**
 * Pagos con Stripe — proveedor de pago ACTIVO (Redsys fue eliminado de la API:
 * no existe backend al que llamar; no volver a documentarlo sin reintroducirlo).
 *
 *   POST /payments/stripe/checkout        { deviceId } → { url } de Stripe Checkout
 *   GET  /payments/stripe/session/:id     verifica una Checkout Session (retorno)
 *   POST /payments/stripe/restore         { deviceId, email } → recupera premium (#251)
 *   POST /payments/stripe/webhook         → checkout.session.completed activa premium
 */

export const stripeRouter = new Hono();

const PRICE_CENTS = Number(process.env['PREMIUM_PRICE_EUR_CENTS'] ?? 499);
const LIFETIME_PRICE_CENTS = Number(process.env['PREMIUM_LIFETIME_PRICE_EUR_CENTS'] ?? 2999);
const WEB_BASE = process.env['WEB_BASE_URL'] ?? 'http://localhost:3001';

/**
 * Catálogo de productos premium (una sola fuente): el precio y el copy de cada
 * uno los usa el Checkout, y el `product` viaja en el metadata de la sesión
 * para que el webhook sepa qué entitlement conceder. El anual es el histórico
 * (`mode: 'payment'` + 1 año) y el de por vida un pago único sin fecha.
 */
const PRODUCTS = {
  annual: {
    amount: PRICE_CENTS,
    name: 'Stick Live Premium — 1 año',
    // #253: solo se anuncia el beneficio real. El resto del copy (i18n) se
    // ajusta por separado; aquí no inventamos features.
    description: 'Disfruta de Stick Live sin publicidad durante un año.',
  },
  lifetime: {
    amount: LIFETIME_PRICE_CENTS,
    name: 'Stick Live Premium — para siempre',
    description: 'Un solo pago: Stick Live sin publicidad para siempre.',
  },
} as const;
type ProductId = keyof typeof PRODUCTS;
function isProductId(v: unknown): v is ProductId {
  // Derivado del propio catálogo: añadir un producto no puede dejarse la
  // validación sin actualizar (evita drift).
  return typeof v === 'string' && Object.hasOwn(PRODUCTS, v);
}

let _stripe: Stripe | null = null;
function stripe(): Stripe {
  const key = process.env['STRIPE_SECRET_KEY'];
  if (!key) throw new Error('STRIPE_SECRET_KEY no configurada');
  return (_stripe ??= new Stripe(key));
}

/**
 * GET /payments/stripe/status?deviceId=...
 * Estado premium AUTORITATIVO con el guard único isUserPremium (auditoría S9 +
 * spec monetización §4): lifetime (compra única Play) o suscripción vigente.
 * La web lo usa para que el premium caduque de verdad en el cliente.
 */
stripeRouter.get('/status', async (c) => {
  const deviceId = c.req.query('deviceId');
  if (!deviceId) return c.json({ error: 'missing_device_id' }, 400);
  const res = await db.query<{ premium_until: string | null; premium_lifetime: boolean }>(
    `SELECT premium_until, premium_lifetime FROM users WHERE device_id = $1`, [deviceId]
  );
  const until = res.rows[0]?.premium_until ?? null;
  const premium = isUserPremium(res.rows[0] ?? undefined);
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
        const res = await db.query<{ premium_until: string | null; premium_lifetime: boolean }>(
          `SELECT premium_until, premium_lifetime FROM users WHERE device_id = $1`, [deviceId]
        );
        const until = res.rows[0]?.premium_until ?? null;
        // Guard único: solo si el usuario YA es premium (lifetime o caducidad
        // futura) se sobreescribe el estado derivado de Stripe.
        if (isUserPremium({ premium_until: until, premium_lifetime: res.rows[0]?.premium_lifetime })) {
          premium = true;
          premiumUntil = until;
        }
      } catch (dbErr) {
        // Un fallo de BD no debe tumbar el pago ya verificado con Stripe.
        logger.error({ err: dbErr }, '[stripe] session db lookup error');
      }
    }

    return c.json({ paid, premium, premiumUntil, product: session.metadata?.['product'] ?? 'annual' });
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
    const body = await c.req.json<{ deviceId?: string; product?: unknown }>();
    const { deviceId } = body;
    if (!deviceId) return c.json({ error: 'missing_device_id' }, 400);
    // Ausente (`undefined`) = 'annual' (compatibilidad total con los callers
    // actuales). Un valor PRESENTE que no esté en el catálogo —incluido `null` o
    // un tipo equivocado— es un error de entrada, nunca un default silencioso.
    let productId: ProductId;
    if (body.product === undefined) productId = 'annual';
    else if (isProductId(body.product)) productId = body.product;
    else return c.json({ error: 'unknown_product' }, 400);
    const chosen = PRODUCTS[productId];

    // Asegurar que el usuario existe (misma semántica que Redsys)
    const userRes = await db.query<{ id: string; premium_until: string | null; premium_lifetime: boolean; stripe_customer_id: string | null }>(
      `INSERT INTO users (device_id) VALUES ($1)
       ON CONFLICT (device_id) DO UPDATE SET updated_at = NOW()
       RETURNING id, premium_until, premium_lifetime, stripe_customer_id`,
      [deviceId]
    );
    // Premium activo = guard único (lifetime o premium_until en el futuro; no
    // el flag is_premium, que nunca se revierte). Un premium caducado puede
    // re-comprar; un lifetime NO debe poder recomprar.
    if (isUserPremium(userRes.rows[0])) {
      return c.json({ error: 'already_premium' }, 409);
    }

    const user = userRes.rows[0]!;

    // Customer de Stripe por usuario (#251): el Checkout le recolecta el email
    // y es la única pieza que permite RESTAURAR el premium en otro dispositivo
    // más adelante. Reutiliza el customer si ya hubo compra/restore.
    let customerId = user.stripe_customer_id ?? undefined;
    if (!customerId) {
      const customer = await stripe().customers.create({
        metadata: { deviceId, userId: user.id },
      });
      customerId = customer.id;
      await db.query(
        `UPDATE users SET stripe_customer_id = $2, updated_at = NOW() WHERE id = $1`,
        [user.id, customerId]
      );
    }

    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: chosen.amount,
          product_data: {
            name: chosen.name,
            description: chosen.description,
          },
        },
      }],
      metadata: { deviceId, userId: userRes.rows[0]!.id, product: productId },
      // Stripe sustituye {CHECKOUT_SESSION_ID} por el id real. La página de
      // éxito lo usa para verificar el pago server-side antes de dar premium.
      success_url: `${WEB_BASE}/premium/success?provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${WEB_BASE}/premium/error?provider=stripe`,
    });

    return c.json({ url: session.url });
  } catch (err) {
    captureRouteError(err, 'stripe] checkout error');
    logger.error({ err }, '[stripe] checkout error');
    return c.json({ error: 'server_error' }, 500);
  }
});

/**
 * POST /payments/stripe/restore  { deviceId, email }
 * Restaura el premium en ESTE dispositivo localizando los pagos del customer
 * por el email que el Checkout recolectó (#251). El entitlement restaurado es
 * el de la compra original (última sesión pagada + 1 año), no un año nuevo
 * desde hoy. Si no hay pagos para ese email, respuesta genérica sin premium —
 * misma forma para "email sin compras" y "email inexistente" (anti-enumeración).
 * Rate-limit estricto: es un endpoint que consulta la API de Stripe.
 */
stripeRouter.post('/restore', rateLimit(5, 3_600_000), async (c) => {
  try {
    const { deviceId, email } = await c.req.json<{ deviceId?: string; email?: string }>();
    if (!deviceId) return c.json({ error: 'missing_device_id' }, 400);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return c.json({ error: 'missing_email' }, 400);
    }

    // El usuario del dispositivo NUEVO (donde se quiere restaurar)
    const userRes = await db.query<{ id: string; premium_until: string | null; premium_lifetime: boolean; stripe_customer_id: string | null }>(
      `INSERT INTO users (device_id) VALUES ($1)
       ON CONFLICT (device_id) DO UPDATE SET updated_at = NOW()
       RETURNING id, premium_until, premium_lifetime, stripe_customer_id`,
      [deviceId]
    );
    const user = userRes.rows[0]!;
    // Guard único: un lifetime NO debe poder "restaurar" (ya es premium para siempre).
    if (isUserPremium(user)) {
      return c.json({ error: 'already_premium' }, 409);
    }

    // Customers de Stripe con ese email (típicamente 0 o 1)
    const customers = await stripe().customers.list({ email, limit: 5 });
    let paidUntil: Date | null = null;
    let paidCustomerId: string | null = null;
    // Una compra de por vida manda sobre cualquier anual: se restaura como
    // lifetime (sin fecha) en vez de como caducidad.
    let paidLifetime = false;

    for (const customer of customers.data) {
      const sessions = await stripe().checkout.sessions.list({
        customer: customer.id,
        limit: 50,
      });
      for (const session of sessions.data) {
        if (!isPaidCheckoutSession(session)) continue;
        if (session.metadata?.['product'] === 'lifetime') {
          paidLifetime = true;
          paidCustomerId = customer.id;
          continue;
        }
        // Si ya hay una compra de por vida, no la pisamos con una anual de otro
        // customer con el mismo email: el lifetime manda también en el vínculo.
        if (paidLifetime) continue;
        // El entitlement es la compra ORIGINAL: última sesión pagada + 1 año
        // (el webhook ya extendió en su día desde la compra en el dispositivo
        // original; restaurar "ahora + 1 año" regalaría un año por reinstalar).
        const until = new Date((session.created + 365 * 24 * 3_600) * 1_000);
        if (!paidUntil || until > paidUntil) {
          paidUntil = until;
          paidCustomerId = customer.id;
        }
      }
    }

    if (!paidCustomerId || (!paidLifetime && !paidUntil)) {
      return c.json({ premium: false });
    }

    if (paidLifetime) {
      // Pago único restaurado: lifetime sin fecha. No se toca premium_until.
      await db.query(
        `UPDATE users
            SET stripe_customer_id = $2,
                is_premium = TRUE,
                premium_lifetime = TRUE,
                updated_at = NOW()
          WHERE id = $1`,
        [user.id, paidCustomerId]
      );
      logger.info({ userId: user.id }, '[stripe] Premium lifetime restaurado (#251)');

      return c.json({ premium: true, premiumUntil: null, premiumLifetime: true });
    }

    // Vincula el dispositivo nuevo al customer pagado y concede el entitlement
    // original (GREATEST: si por carrera el dispositivo ya tuviera premium
    // posterior, no se encoge).
    await db.query(
      `UPDATE users
          SET stripe_customer_id = $2,
              is_premium = TRUE,
              premium_until = GREATEST(COALESCE(premium_until, NOW()), $3::timestamptz),
              updated_at = NOW()
        WHERE id = $1`,
      [user.id, paidCustomerId, paidUntil!.toISOString()]
    );
    logger.info({ userId: user.id, paidUntil: paidUntil!.toISOString() }, '[stripe] Premium restaurado (#251)');

    return c.json({
      premium: isPremiumActive(paidUntil!.toISOString()),
      premiumUntil: paidUntil!.toISOString(),
      premiumLifetime: false,
    });
  } catch (err) {
    captureRouteError(err, 'stripe] restore error');
    logger.error({ err }, '[stripe] restore error');
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
  let analyticsProduct = 'annual';
  // Producto PRESENTE pero desconocido: fail-closed, no se acredita nada.
  let unknownProduct: string | null = null;

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
      const rawProduct = session.metadata?.['product'];

      if (rawProduct !== undefined && !isProductId(rawProduct)) {
        // Fail-closed: 'annual'/'lifetime' o ausente (sesiones históricas) sí
        // conceden; cualquier otro valor PRESENTE no acredita NADA. Se alerta
        // fuera de la transacción (abajo).
        unknownProduct = String(rawProduct);
      } else {
        const product: ProductId = rawProduct === undefined ? 'annual' : rawProduct;

        if (userId) {
          if (product === 'lifetime') {
            // Pago único: lifetime sin fecha. NO se toca premium_until (la compra
            // de por vida no fabrica ni pisa una caducidad).
            await tx.query(
              `UPDATE users SET is_premium = TRUE,
                                premium_lifetime = TRUE,
                                updated_at = NOW()
               WHERE id = $1`,
              [userId]
            );
          } else {
            // Anual, incluida cualquier sesión histórica sin `product`.
            // Extiende desde la caducidad previa si aún está vigente (una
            // renovación anticipada no debe perder los días que quedaban).
            await tx.query(
              `UPDATE users SET is_premium = TRUE,
                                premium_until = GREATEST(COALESCE(premium_until, NOW()), NOW()) + INTERVAL '1 year',
                                updated_at = NOW()
               WHERE id = $1`,
              [userId]
            );
          }
          premiumUserId = userId;
          analyticsDeviceId = session.metadata?.['deviceId'];
          analyticsProduct = product;
          amountTotal = session.amount_total ?? (product === 'lifetime' ? LIFETIME_PRICE_CENTS : PRICE_CENTS);
          logger.info({ userId, product }, '[stripe] Premium activado');
        }
      }
    }
  });

  if (duplicate) return c.json({ received: true, duplicate: true });

  if (unknownProduct !== null) {
    // Se responde 200 (el evento queda marcado como procesado): reintentar no
    // arreglaría el dato corrupto y un 4xx/5xx haría que Stripe reintentase en
    // bucle. La anomalía se reporta a logs/Sentry.
    logger.error(
      { eventId: event.id, product: unknownProduct },
      '[stripe] producto desconocido en checkout.session.completed: no se concede premium'
    );
    captureRouteError(
      new Error(`[stripe] producto desconocido en webhook: ${unknownProduct}`),
      'stripe] webhook unknown product'
    );
    return c.json({ received: true });
  }

  // Analítica de servidor FUERA de la transacción: no debe bloquear ni revertir
  // el efecto del pago. Cierra el funnel premium_checkout_started → purchased.
  if (premiumUserId) {
    try {
      const { analytics } = await import('@sports/analytics');
      analytics.capture({
        distinctId: analyticsDeviceId ?? premiumUserId,
        event: 'premium_purchased',
        properties: { provider: 'stripe', amount_cents: amountTotal, product: analyticsProduct },
      });
      await analytics.flush();
    } catch { /* sin POSTHOG_API_KEY no bloqueamos el webhook */ }
  }

  return c.json({ received: true });
});
