import { db } from '@sports/db';
import type { NonceStore } from './oauth-nonce.js';

/**
 * Almacén de nonces OAuth consumidos en Postgres (#306).
 *
 * `oauth_state_nonces` es pequeña y efímera: cada fila caduca con el propio
 * state (≤ 10 min). `ON CONFLICT DO NOTHING` da la semántica single-use de
 * forma atómica entre instancias de la API (a diferencia de la memoria).
 * La limpieza de caducados es oportunista (el volumen es solo logins).
 */
export const postgresNonceStore: NonceStore = {
  async consume(nonce: string, expiresAt: Date): Promise<boolean> {
    await db.query(`DELETE FROM oauth_state_nonces WHERE expires_at < NOW()`);
    const res = await db.query<{ nonce: string }>(
      `INSERT INTO oauth_state_nonces (nonce, expires_at)
       VALUES ($1, $2)
       ON CONFLICT (nonce) DO NOTHING
       RETURNING nonce`,
      [nonce, expiresAt]
    );
    return res.rows.length > 0;
  },
};
