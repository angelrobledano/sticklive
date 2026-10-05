import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * State de OAuth firmado (HMAC) para prevenir CSRF de login (auditoría S4).
 *
 * Extraído de auth.ts a un módulo PURO (sin `db`) para poder fijar su
 * comportamiento con tests unitarios: firma estable, verificación en tiempo
 * constante y rechazo de cualquier state manipulado.
 *
 * #306: además de la firma, el payload lleva `iat`/`exp` (TTL corto) para que
 * un state filtrado no valga indefinidamente. El single-use del `n` se
 * comprueba aparte (ver `oauth-nonce.ts`): aquí solo se valida firma y TTL.
 */

/** TTL del state OAuth: 10 minutos. */
export const STATE_TTL_SECONDS = 10 * 60;

export interface OAuthState {
  /** deviceId del usuario (opcional). */
  d?: string;
  /** nonce aleatorio por request (single-use). */
  n?: string;
  /** emitido en (epoch segundos). */
  iat?: number;
  /** caduca en (epoch segundos). */
  exp?: number;
  /**
   * Login desde la app móvil (Task 3.1): el callback de Google emite un código
   * de canje single-use en vez de una sesión web. Solo viaja si el cliente pidió
   * `?client=app`; verificado con el mismo HMAC que el resto del payload.
   */
  client?: 'app';
}

function stateSecret(): string {
  // Secreto solo-servidor. Si no hay uno dedicado, se usa el de Google (presente
  // siempre que OAuth está configurado).
  return process.env['AUTH_STATE_SECRET'] ?? process.env['GOOGLE_CLIENT_SECRET'] ?? '';
}

/**
 * Firma un payload añadiendo `iat`/`exp`. `now` (ms) se inyecta en tests.
 */
export function signState(payload: Record<string, unknown>, now: number = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat, exp: iat + STATE_TTL_SECONDS })
  ).toString('base64url');
  const sig = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Verifica la firma y la caducidad. Devuelve el payload, o null si el state
 * falta, está manipulado, no trae `exp` o ya caducó. `now` (ms) para tests.
 */
export function verifyState(raw: string | undefined, now: number = Date.now()): OAuthState | null {
  if (!raw) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString()) as OAuthState;
    // TTL obligatorio: sin `exp` (o ya caducado) el state no vale.
    if (typeof parsed.exp !== 'number' || parsed.exp * 1000 <= now) return null;
    return parsed;
  } catch {
    return null;
  }
}
