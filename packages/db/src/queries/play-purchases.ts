import { db } from '../client.js';

export type PlayProductId = 'premium_annual' | 'premium_lifetime';
export type PlayPurchaseState = 'active' | 'expired' | 'revoked';

export interface DbPlayPurchase {
  id: string;
  user_id: string;
  product_id: PlayProductId;
  purchase_token: string;
  order_id: string | null;
  state: PlayPurchaseState;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Dueño del token, para la idempotencia/carrera de /verify. */
export async function findPurchaseByToken(
  purchaseToken: string
): Promise<DbPlayPurchase | null> {
  const res = await db.query<DbPlayPurchase>(
    'SELECT * FROM play_purchases WHERE purchase_token = $1',
    [purchaseToken]
  );
  return res.rows[0] ?? null;
}

/** Suscripciones anuales activas que el reconciler debe revalidar. */
export async function listActiveAnnualPurchases(): Promise<DbPlayPurchase[]> {
  const res = await db.query<DbPlayPurchase>(
    `SELECT * FROM play_purchases
      WHERE state = 'active' AND product_id = 'premium_annual'
      ORDER BY expires_at NULLS LAST`
  );
  return res.rows;
}

/** Compras lifetime activas (para reembolsos vía voidedpurchases). */
export async function listActiveLifetimePurchases(): Promise<DbPlayPurchase[]> {
  const res = await db.query<DbPlayPurchase>(
    `SELECT * FROM play_purchases
      WHERE state = 'active' AND product_id = 'premium_lifetime'`
  );
  return res.rows;
}
