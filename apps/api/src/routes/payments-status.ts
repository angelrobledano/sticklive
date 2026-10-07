import { Hono } from 'hono';
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import { rateLimit } from '../lib/rate-limit.js';
import { captureRouteError } from '../lib/route-error.js';
import { isUserPremium } from '../lib/premium.js';
import { userFromBearer } from '../lib/session-lookup.js';

/**
 * Estado premium de la SESIÓN (Bearer) — lo consume la app móvil para no
 * mostrar publicidad. La compra NUNCA ocurre en la app: el usuario paga en la
 * web (Stripe checkout → webhook → users), y aquí solo se LEE el entitlement
 * de la fila `users` que la sesión resuelve (misma cuenta → misma fila, ver
 * resolveUserByEmail en routes/auth.ts).
 *
 *   GET /payments/status → { premium, premiumUntil, premiumLifetime }
 *
 * El guard es el ÚNICO del sistema (isUserPremium: lifetime OR
 * premium_until > NOW()); la respuesta NO incluye flags internos.
 */
export const statusRouter = new Hono();

statusRouter.get('/', rateLimit(60, 60_000), async (c) => {
  try {
    const user = await userFromBearer(c.req.header('Authorization'));
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const res = await db.query<{ premium_until: string | Date | null; premium_lifetime: boolean }>(
      'SELECT premium_until, premium_lifetime FROM users WHERE id = $1',
      [user.id]
    );
    const row = res.rows[0] ?? null;
    const premiumUntil = row?.premium_until
      ? new Date(row.premium_until).toISOString()
      : null;

    return c.json({
      premium: isUserPremium(row ?? undefined),
      premiumUntil,
      premiumLifetime: row?.premium_lifetime ?? false,
    });
  } catch (err) {
    captureRouteError(err, '[payments] status error');
    logger.error({ err }, '[payments] status error');
    return c.json({ error: 'server_error' }, 500);
  }
});
