/**
 * Single-use de nonces del state OAuth (#306).
 *
 * `auth-state.ts` firma y comprueba la expiración del state, pero un state
 * firmado es reutilizable mientras esté vigente. Este almacén registra los
 * nonces ya consumidos: el callback solo continúa si el nonce es nuevo.
 *
 * El módulo es PURO (sin `db`) para poder fijar su comportamiento con tests.
 * La implementación contra Postgres vive en `oauth-nonce-pg.ts`.
 */
export interface NonceStore {
  /**
   * Marca `nonce` como usado. Devuelve true si era nuevo (puede continuar) y
   * false si ya se había consumido (rechazar: reutilización).
   */
  consume(nonce: string, expiresAt: Date): Promise<boolean>;
}

/** Almacén en memoria con purga de caducados; para tests y un único nodo. */
export function createMemoryNonceStore(now: () => number = Date.now): NonceStore {
  const used = new Map<string, number>(); // nonce → expiración (ms)
  return {
    async consume(nonce: string, expiresAt: Date): Promise<boolean> {
      const t = now();
      for (const [k, exp] of used) if (exp <= t) used.delete(k);
      if (used.has(nonce)) return false;
      used.set(nonce, expiresAt.getTime());
      return true;
    },
  };
}
