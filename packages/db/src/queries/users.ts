import { db } from '../client.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface DbUser {
  id: string;
  device_id: string;
  is_premium: boolean;
  premium_until: Date | null;
  email: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DbOrder {
  id: string;
  user_id: string;
  ds_order: string;
  amount_cents: number;
  currency: string;
  status: 'pending' | 'authorized' | 'failed' | 'refunded';
  ds_response: string | null;
  ds_auth_code: string | null;
  ds_card_country: string | null;
  webhook_raw: Record<string, unknown> | null;
  authorized_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Devuelve el usuario por device_id, creándolo si no existe.
 */
export async function upsertUser(deviceId: string, email?: string): Promise<DbUser> {
  const result = await db.query<DbUser>(
    `INSERT INTO users (device_id, email)
     VALUES ($1, $2)
     ON CONFLICT (device_id) DO UPDATE SET
       email      = COALESCE(EXCLUDED.email, users.email),
       updated_at = NOW()
     RETURNING *`,
    [deviceId, email ?? null]
  );
  return result.rows[0]!;
}

export async function findUserByDeviceId(deviceId: string): Promise<DbUser | null> {
  const result = await db.query<DbUser>(
    'SELECT * FROM users WHERE device_id = $1',
    [deviceId]
  );
  return result.rows[0] ?? null;
}

/**
 * Crea un pedido en estado "pending" para el usuario dado.
 * ds_order debe ser único — se genera en la capa de aplicación.
 */
export async function createOrder(
  userId: string,
  dsOrder: string,
  amountCents: number
): Promise<DbOrder> {
  const result = await db.query<DbOrder>(
    `INSERT INTO orders (user_id, ds_order, amount_cents)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, dsOrder, amountCents]
  );
  return result.rows[0]!;
}

export async function findOrderByDsOrder(dsOrder: string): Promise<DbOrder | null> {
  const result = await db.query<DbOrder>(
    'SELECT * FROM orders WHERE ds_order = $1',
    [dsOrder]
  );
  return result.rows[0] ?? null;
}

/**
 * Marca el pedido como "authorized" y activa is_premium en el usuario.
 * Se ejecuta dentro de una transacción para garantizar consistencia.
 */
export async function authorizeOrderAndGrantPremium(
  dsOrder: string,
  dsResponse: string,
  dsAuthCode: string | null,
  dsCardCountry: string | null,
  webhookRaw: Record<string, unknown>
): Promise<{ order: DbOrder; user: DbUser }> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1. Actualizar el pedido
    const orderResult = await client.query<DbOrder>(
      `UPDATE orders SET
         status          = 'authorized',
         ds_response     = $2,
         ds_auth_code    = $3,
         ds_card_country = $4,
         webhook_raw     = $5,
         authorized_at   = NOW(),
         updated_at      = NOW()
       WHERE ds_order = $1
       RETURNING *`,
      [dsOrder, dsResponse, dsAuthCode, dsCardCountry, JSON.stringify(webhookRaw)]
    );

    if (orderResult.rowCount === 0) {
      throw new Error(`Order not found: ${dsOrder}`);
    }
    const order = orderResult.rows[0]!;

    // 2. Activar premium en el usuario (suscripción anual)
    const userResult = await client.query<DbUser>(
      `UPDATE users SET
         is_premium    = TRUE,
         premium_until = NOW() + INTERVAL '1 year',
         updated_at    = NOW()
       WHERE id = $1
       RETURNING *`,
      [order.user_id]
    );

    await client.query('COMMIT');
    return { order, user: userResult.rows[0]! };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Marca el pedido como "failed" (webhook de pago rechazado).
 */
export async function failOrder(
  dsOrder: string,
  dsResponse: string,
  webhookRaw: Record<string, unknown>
): Promise<DbOrder> {
  const result = await db.query<DbOrder>(
    `UPDATE orders SET
       status      = 'failed',
       ds_response = $2,
       webhook_raw = $3,
       updated_at  = NOW()
     WHERE ds_order = $1
     RETURNING *`,
    [dsOrder, dsResponse, JSON.stringify(webhookRaw)]
  );
  return result.rows[0]!;
}
