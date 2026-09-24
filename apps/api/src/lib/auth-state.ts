import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * State de OAuth firmado (HMAC) para prevenir CSRF de login (auditoría S4).
 *
 * Extraído de auth.ts a un módulo PURO (sin `db`) para poder fijar su
 * comportamiento con tests unitarios: firma estable, verificación en tiempo
 * constante y rechazo de cualquier state manipulado.
 */
function stateSecret(): string {
  // Secreto solo-servidor. Si no hay uno dedicado, se usa el de Google (presente
  // siempre que OAuth está configurado).
  return process.env['AUTH_STATE_SECRET'] ?? process.env['GOOGLE_CLIENT_SECRET'] ?? '';
}

export function signState(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyState(raw: string | undefined): { d?: string } | null {
  if (!raw) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
}
