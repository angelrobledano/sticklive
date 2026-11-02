/**
 * Firma HMAC de las peticiones que van al Cloudflare Worker.
 *
 * El Worker es un endpoint público en `*.workers.dev`: sin firma, cualquiera
 * podría usarlo como proxy hacia SIDGAD. La firma cubre método, ruta, timestamp
 * y hash del cuerpo, con una ventana de reloj corta.
 *
 * Canonical string (idéntico en Worker y servidor):
 *   `${timestamp}\n${METHOD}\n${pathWithQuery}\n${sha256hex(body)}`
 */
import { createHash, createHmac } from 'node:crypto';

const PORTAL_RE = /^[a-z0-9]+$/;
const ENDPOINT_RE = /^[A-Za-z0-9_.-]+\.php$/;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function buildCanonicalString(
  timestamp: string,
  method: string,
  pathWithQuery: string,
  body: string
): string {
  return `${timestamp}\n${method.toUpperCase()}\n${pathWithQuery}\n${sha256Hex(body)}`;
}

export function signEgressRequest(input: {
  secret: string;
  timestamp: string;
  method: string;
  pathWithQuery: string;
  body: string;
}): string {
  const canonical = buildCanonicalString(
    input.timestamp,
    input.method,
    input.pathWithQuery,
    input.body
  );
  return createHmac('sha256', input.secret).update(canonical, 'utf8').digest('hex');
}

/**
 * `buildWorkerPath('rfep', 'rfep_cal_idc_3150_1.php')`
 *   → `/rfep/rfep_cal_idc_3150_1.php`
 *
 * Solo se permiten portales y endpoints con la forma esperada: así el Worker
 * nunca se convierte en un proxy abierto ni acepta `..`/URLs absolutas.
 */
export function buildWorkerPath(portal: string, endpointPath: string): string {
  if (!PORTAL_RE.test(portal)) {
    throw new Error(`Portal SIDGAD inválido para el Worker: "${portal}"`);
  }
  const clean = endpointPath.replace(/^\/+/, '');
  if (clean.includes('?') || clean.includes('#') || clean.includes('..')) {
    throw new Error(`Endpoint SIDGAD inválido para el Worker: "${endpointPath}"`);
  }
  if (!ENDPOINT_RE.test(clean)) {
    throw new Error(`Endpoint SIDGAD inválido para el Worker (se espera *.php): "${endpointPath}"`);
  }
  return `/${portal}/${clean}`;
}
