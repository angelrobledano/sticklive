/**
 * #362: normalización de errores de login a claves i18n seguras (nunca el texto
 * crudo del API).
 *
 * Vive FUERA de `page.tsx` a propósito: Next solo permite exports de ruta en una
 * página (default/metadata/…) y un export extra (p. ej. esta clase) hace fallar
 * `next build` con "does not satisfy the constraint '{ [x: string]: never; }'".
 */

export function loginErrorKey(code: string | null | undefined): string {
  switch (code) {
    case 'invalid_email':        return 'auth.error_invalid_email';
    case 'email_not_configured': return 'auth.error_email_unavailable';
    case 'expired':              return 'auth.expired';
    case 'account_disabled':     return 'auth.account_disabled';
    default:                     return 'auth.error_generic';
  }
}

/** Error de login ya normalizado a una clave i18n (nunca texto del API). */
export class LoginRequestError extends Error {
  constructor(readonly key: string) {
    super(key);
    this.name = 'LoginRequestError';
  }
}
