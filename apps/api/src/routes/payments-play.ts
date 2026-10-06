/**
 * Pagos con Google Play Billing — verificación SERVER-SIDE de compras hechas
 * en la app (spec monetización §5). La app compra con react-native-iap y envía
 * el purchaseToken aquí; la API valida contra Google y concede.
 *
 *   POST /payments/play/verify   { purchaseToken, productId } → entitlement
 *   GET  /payments/play/status   → estado premium autoritativo de la sesión
 *
 * Idempotencia por purchase_token (UNIQUE + ON CONFLICT, patrón
 * processed_stripe_events): el reintento del mismo usuario responde el
 * entitlement SIN volver a consultar a Google, y un token reclamado por otra
 * cuenta es 409 explícito (nunca se concede en cross-account).
 *
 * Productos esperados (Play Console):
 *   premium_annual   → suscripción anual (purchases.subscriptionsv2.get)
 *   premium_lifetime → compra única no consumible (purchases.products.get)
 */
import { Hono } from 'hono';
import { db, findPurchaseByToken, withTransaction, type PlayProductId } from '@sports/db';
import { logger } from '@sports/logger';

import { rateLimit } from '../lib/rate-limit.js';
import { captureRouteError } from '../lib/route-error.js';
import { isUserPremium } from '../lib/premium.js';
import { userFromBearer } from '../lib/session-lookup.js';
import { getProduct, getSubscription, PlayApiError } from '../lib/play.js';

const PRODUCTS: readonly PlayProductId[] = ['premium_annual', 'premium_lifetime'];

function isProductId(value: unknown): value is PlayProductId {
  return typeof value === 'string' && (PRODUCTS as readonly string[]).includes(value);
}

/** Prefijo abreviado del token para logs (mismo criterio que lib/play.ts). */
function tokenPrefix(purchaseToken: string): string {
  return purchaseToken.slice(0, 8);
}

export const playRouter = new Hono();

/**
 * Entitlement recalculado desde `users` — la única fuente de verdad (S9: el
 * flag is_premium NO lo es). `premiumUntil` se normaliza a ISO para que la
 * respuesta no dependa de cómo devuelva la fila el driver.
 */
async function entitlementOf(
  userId: string
): Promise<{ premium: boolean; premiumUntil: string | null; premiumLifetime: boolean }> {
  const res = await db.query<{ premium_until: Date | string | null; premium_lifetime: boolean }>(
    'SELECT premium_until, premium_lifetime FROM users WHERE id = $1',
    [userId]
  );
  const row = res.rows[0];
  return {
    premium: isUserPremium(row),
    premiumUntil: row?.premium_until ? new Date(row.premium_until).toISOString() : null,
    premiumLifetime: row?.premium_lifetime ?? false,
  };
}

playRouter.post('/verify', rateLimit(20, 60_000), async (c) => {
  try {
    const user = await userFromBearer(c.req.header('Authorization'));
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const body = await c.req
      .json<{ purchaseToken?: unknown; productId?: unknown }>()
      .catch(() => ({}) as { purchaseToken?: unknown; productId?: unknown });
    const purchaseToken = body.purchaseToken;
    const productId = body.productId;
    if (
      typeof purchaseToken !== 'string' ||
      purchaseToken.length < 8 ||
      purchaseToken.length > 4096
    ) {
      return c.json({ error: 'missing_purchase_token' }, 400);
    }
    if (!isProductId(productId)) {
      return c.json({ error: 'unknown_product' }, 400);
    }

    // Idempotencia por token ANTES de llamar a Google: el reintento de un
    // usuario con su compra ya registrada no re-consulta la API de Play (cota
    // de latencia/coste) y el secuestro del token de otra cuenta es 409.
    const existing = await findPurchaseByToken(purchaseToken);
    if (existing) {
      if (existing.user_id !== user.id) {
        logger.warn(
          { userId: user.id, productId, token: tokenPrefix(purchaseToken) },
          '[play] purchase token reclamado por otra cuenta'
        );
        return c.json({ error: 'token_owned_by_other_user' }, 409);
      }
      return c.json(await entitlementOf(user.id));
    }

    // Validar contra Google ANTES de tocar la BD: un fallo de Play NUNCA
    // concede premium (502 explícito; la app ofrecerá reintentar).
    const verified =
      productId === 'premium_annual'
        ? await getSubscription(purchaseToken, productId)
        : await getProduct(purchaseToken, productId);
    if (!verified.valid) {
      logger.warn(
        { userId: user.id, productId, token: tokenPrefix(purchaseToken) },
        '[play] compra no válida para conceder'
      );
      return c.json({ error: 'purchase_not_valid' }, 422);
    }

    const premiumUntil =
      verified.kind === 'subscription' && verified.expiresAt
        ? verified.expiresAt.toISOString()
        : null;
    if (productId === 'premium_annual' && !premiumUntil) {
      // Defensa en profundidad: normalizeSubscription ya garantiza expiresAt
      // cuando valid=true, y el CHECK de la migración 070 exige expires_at no
      // NULL en la anual. Nunca insertar una fila que la BD rechazaría.
      logger.warn({ userId: user.id, productId }, '[play] suscripción válida sin expiración');
      return c.json({ error: 'purchase_not_valid' }, 422);
    }

    // Efecto + marca de idempotencia en UNA transacción (patrón webhook de
    // Stripe): si el INSERT del token choca (dos verifies en carrera), el
    // ON CONFLICT deja rowCount=0, no se toca users y se resuelve releyendo
    // al dueño — la concesión paralela ya fue efectiva o esta petición la hace.
    let inserted = true;
    await withTransaction(async (tx) => {
      const ins = await tx.query(
        `INSERT INTO play_purchases (user_id, product_id, purchase_token, state, expires_at)
         VALUES ($1, $2, $3, 'active', $4)
         ON CONFLICT (purchase_token) DO NOTHING
         RETURNING user_id`,
        [user.id, productId, purchaseToken, premiumUntil]
      );
      if ((ins.rowCount ?? 0) === 0) {
        inserted = false;
        return;
      }
      if (productId === 'premium_lifetime') {
        await tx.query(
          `UPDATE users SET is_premium = TRUE, premium_lifetime = TRUE, updated_at = NOW()
           WHERE id = $1`,
          [user.id]
        );
      } else {
        // GREATEST: una compra nueva no encoge un premium ya vigente.
        await tx.query(
          `UPDATE users SET is_premium = TRUE,
                             premium_until = GREATEST(COALESCE(premium_until, NOW()), $2::timestamptz),
                             updated_at = NOW()
           WHERE id = $1`,
          [user.id, premiumUntil]
        );
      }
    });

    if (!inserted) {
      // Carrera: otro verify insertó el token entre la lectura y la TX.
      const owner = await findPurchaseByToken(purchaseToken);
      if (!owner || owner.user_id !== user.id) {
        logger.warn(
          { userId: user.id, productId, token: tokenPrefix(purchaseToken) },
          '[play] carrera de verify: token registrado por otra cuenta'
        );
        return c.json({ error: 'token_owned_by_other_user' }, 409);
      }
      return c.json(await entitlementOf(user.id));
    }

    logger.info(
      { userId: user.id, productId, token: tokenPrefix(purchaseToken) },
      '[play] Premium concedido vía Google Play'
    );

    // Analítica de servidor FUERA de la transacción (patrón Stripe): no debe
    // bloquear ni revertir el efecto del pago.
    try {
      const { analytics } = await import('@sports/analytics');
      analytics.capture({
        distinctId: user.id,
        event: 'premium_purchased',
        properties: { provider: 'play', product_id: productId },
      });
      await analytics.flush();
    } catch { /* sin POSTHOG_API_KEY no bloqueamos la respuesta */ }

    return c.json(await entitlementOf(user.id));
  } catch (err) {
    if (err instanceof PlayApiError) {
      if (err.status === 404) {
        // Token inexistente/falso: compra inválida del cliente, no un fallo del
        // sistema → no captura a Sentry.
        logger.warn({ err, status: err.status }, '[play] token inexistente en Play');
        return c.json({ error: 'purchase_not_valid' }, 422);
      }
      // 401/403 (permisos de la SA), 429, 5xx, timeout (status 0): fallo del
      // sistema, reintentable desde la app.
      logger.error({ err, status: err.status }, '[play] Play no disponible');
      return c.json({ error: 'play_unavailable' }, 502);
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('play_not_configured')) {
      logger.error({ err }, '[play] Play sin configurar');
      return c.json({ error: 'play_not_configured' }, 503);
    }
    captureRouteError(err, 'play] verify error');
    logger.error({ err }, '[play] verify error');
    return c.json({ error: 'server_error' }, 500);
  }
});

playRouter.get('/status', rateLimit(60, 60_000), async (c) => {
  try {
    const user = await userFromBearer(c.req.header('Authorization'));
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    return c.json(await entitlementOf(user.id));
  } catch (err) {
    captureRouteError(err, 'play] status error');
    logger.error({ err }, '[play] status error');
    return c.json({ error: 'server_error' }, 500);
  }
});
