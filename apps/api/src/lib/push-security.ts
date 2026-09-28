import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Seguridad de los endpoints públicos de Web Push (#305).
 *
 * Lógica PURA y testeable, separada de la ruta HTTP:
 *   · validación del `endpoint` del push service (anti-SSRF saliente y
 *     anti-polucion de la tabla `push_subscriptions`),
 *   · prueba de ownership para el DELETE (deviceId que coincide o token
 *     firmado emitido en el subscribe).
 *
 * El `endpoint` lo controla el cliente, así que se trata como dato NO fiable:
 * solo se aceptan URLs https de los push services conocidos. El emisor (ETL)
 * hace POST saliente a esa URL con `web-push`, de ahí el riesgo de SSRF.
 */

/** Hosts exactos de push services conocidos (Chrome, Firefox y Safari). */
const ALLOWED_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',                 // Chrome/Edge (Firebase Cloud Messaging)
  'updates.push.services.mozilla.com',  // Firefox
  'web.push.apple.com',                 // Safari / PWA iOS
]);

/** Sufijos admitidos: cubren subdominios de los mismos servicios. */
const ALLOWED_PUSH_SUFFIXES = [
  '.push.apple.com',
  '.push.services.mozilla.com',
  '.notify.windows.com',                // Edge (Windows Notification Service)
];

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * ¿Es `endpoint` un endpoint aceptable de un push service conocido?
 *
 * Exige https, host de la allowlist y puerto 443 (o ninguno). Rechaza IPs
 * literales, credenciales embebidas y puertos no estándar: cualquier intento
 * de apuntar a hosts internos (SSRF) queda fuera.
 */
export function isAllowedPushEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  // Los push services usan 443; otro puerto es señal de SSRF o abuso.
  if (url.port && url.port !== '443') return false;

  const host = url.hostname.toLowerCase();
  // Un literal de IP nunca es un push service legítimo (y evita hosts internos).
  if (IPV4_RE.test(host) || host.startsWith('[') || host.includes(':')) return false;

  if (ALLOWED_PUSH_HOSTS.has(host)) return true;
  return ALLOWED_PUSH_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Token de baja (capability): HMAC del deviceId + endpoint. Se devuelve en el
 * subscribe y permite borrar la suscripción sin exponer el secreto del state.
 * Determinista por suscripción; solo lo ve quien se suscribió.
 */
function ownershipSecret(): string {
  return process.env['AUTH_STATE_SECRET'] ?? process.env['GOOGLE_CLIENT_SECRET'] ?? '';
}

export function makeUnsubscribeToken(deviceId: string, endpoint: string): string {
  return createHmac('sha256', ownershipSecret())
    .update(`${deviceId}\n${endpoint}`)
    .digest('base64url');
}

export function verifyUnsubscribeToken(
  token: string | undefined,
  deviceId: string,
  endpoint: string
): boolean {
  if (!token) return false;
  const expected = makeUnsubscribeToken(deviceId, endpoint);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SubscriptionOwner {
  deviceId: string;
  endpoint: string;
}

export interface DeleteProof {
  deviceId?: string;
  token?: string;
}

/**
 * ¿Puede quien llama borrar esta suscripción?
 *
 * Firma del deviceId de la fila (el atacante que solo conoce el `endpoint` no
 * lo tiene) o el token de baja emitido en el subscribe. Las filas legacy sin
 * device_id real no tienen dueño al que proteger.
 */
export function canDeleteSubscription(owner: SubscriptionOwner, proof: DeleteProof): boolean {
  if (!owner.deviceId || owner.deviceId === 'unknown') return true;
  if (proof.deviceId && proof.deviceId === owner.deviceId) return true;
  return verifyUnsubscribeToken(proof.token, owner.deviceId, owner.endpoint);
}

/** Tope de suscripciones por dispositivo; al superarlo se borran las más viejas. */
export const MAX_PUSH_SUBS_PER_DEVICE = 5;
