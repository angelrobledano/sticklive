/**
 * Cliente de la Google Play Developer API (androidpublisher v3) SIN
 * dependencias: service account → JWT RS256 (node:crypto) → access token,
 * con caché en memoria. Módulo importable sin credenciales: si faltan,
 * cada llamada falla EXPLÍCITA (play_not_configured) — nunca silencio.
 *
 * Todo fallo de red/HTTP sale como PlayApiError (con estado HTTP; 0 = sin
 * respuesta, p. ej. timeout) y mensaje con prefijo play_*: la ruta de
 * verificación mapea por prefijo y el reconciler puede usar instanceof+status.
 *
 * Referencia (shapes verificados contra la doc oficial el 2026-10-06):
 * https://developers.google.com/android-publisher/api-ref/rest
 */
import { createSign } from 'node:crypto';

import { logger } from '@sports/logger';

/** Timeout del POST de token OAuth (10 s: servicio pequeño, sin paginar). */
const TOKEN_TIMEOUT_MS = 10_000;
/** Timeout de las llamadas a androidpublisher (15 s: pueden ser más lentas). */
const API_TIMEOUT_MS = 15_000;
/** Tope de páginas en voidedpurchases: cinta de seguridad, no bucle infinito. */
const MAX_VOIDED_PAGES = 10;

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';

/**
 * Error de la API de Google con su estado HTTP (0 = sin respuesta/timeout).
 * El mensaje conserva el prefijo play_* (mapeo por prefijo en la ruta).
 */
export class PlayApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PlayApiError';
    this.status = status;
  }
}

export interface PlayCredentials {
  email: string;
  privateKey: string;
}

export function getPlayCredentials(): PlayCredentials {
  return {
    email: process.env['GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL'] ?? '',
    // La clave llega con \n literales desde .env.prod: normalizar.
    privateKey: (process.env['GOOGLE_PLAY_PRIVATE_KEY'] ?? '').replace(/\\n/g, '\n'),
  };
}

/**
 * JWT firmado (puro, testeable). exp a 1 h; Google acepta ≤ 1 h.
 * `nowSec` viaja en el propio objeto de credenciales para poder inyectarlo en
 * tests (contrato del test unitario).
 */
export function buildPlayJwt(creds: PlayCredentials & { nowSec?: number }): string {
  const nowSec = creds.nowSec ?? Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: creds.email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3_600,
  };
  const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const input = `${b64url(header)}.${b64url(claims)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  const signature = signer.sign(creds.privateKey.replace(/\\n/g, '\n'), 'base64url');
  return `${input}.${signature}`;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

let cached: CachedToken | null = null;

/**
 * Solo tests: la caché de token es module-level y las pruebas (y el orden de
 * ejecución) deben poder vaciarla para ser deterministas.
 */
export function resetTokenCacheForTest(): void {
  cached = null;
}

/** AbortSignal.timeout aborta con TimeoutError; undici a veces lo envuelve en cause. */
function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  const cause = (err as { cause?: unknown }).cause;
  return cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
}

/** Access token con caché (margen de 60 s). Falla explícito sin credenciales. */
export async function getAccessToken(
  creds: PlayCredentials = getPlayCredentials()
): Promise<string> {
  if (!creds.email || !creds.privateKey) {
    // No es PlayApiError: no es un fallo de red sino de configuración (la ruta
    // lo mapea a 503, no a reintentable).
    throw new Error(
      'play_not_configured: faltan GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL / GOOGLE_PLAY_PRIVATE_KEY'
    );
  }
  if (cached && cached.expiresAtMs > Date.now() + 60_000) return cached.token;

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: buildPlayJwt(creds),
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch (err) {
    if (isTimeoutError(err)) throw new PlayApiError(0, 'play_api_error: timeout');
    throw err;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.error({ status: res.status, detail }, '[play] token error');
    throw new PlayApiError(res.status, `play_token_error: google respondió ${res.status}`);
  }
  let json: { access_token?: string; expires_in?: number };
  try {
    json = (await res.json()) as { access_token?: string; expires_in?: number };
  } catch {
    throw new PlayApiError(res.status, 'play_token_error: respuesta no válida');
  }
  if (!json.access_token) {
    throw new PlayApiError(res.status, 'play_token_error: respuesta sin access_token');
  }
  cached = {
    token: json.access_token,
    expiresAtMs: Date.now() + (json.expires_in ?? 3_600) * 1_000,
  };
  return cached.token;
}

/** Exportada SOLO para tests (misma lógica, permite inyectar credenciales). */
export const getAccessTokenForTest = getAccessToken;

// ── Normalización (pura) ─────────────────────────────────────────────────────

/** Payload de purchases.subscriptionsv2.get que consume la normalización. */
interface SubscriptionV2Payload {
  subscriptionState?: string;
  lineItems?: Array<{ productId?: string; expiryTime?: string }>;
}

/** Payload de purchases.products.get que consume la normalización. */
interface ProductPurchasePayload {
  purchaseState?: number;
}

/** Página de purchases.voidedpurchases.list (resp. oficial con paginación). */
interface VoidedPurchasesPage {
  voidedPurchases?: Array<{ purchaseToken?: string }>;
  tokenPagination?: { nextPageToken?: string };
}

export interface NormalizedSubscription {
  kind: 'subscription';
  valid: boolean; // puede conceder premium AHORA
  active: boolean; // activa o en grace period (acceso vigente según doc)
  expiresAt: Date | null;
}

export interface NormalizedProduct {
  kind: 'product';
  valid: boolean; // purchaseState 0
  purchased: boolean;
}

/**
 * Estados con acceso vigente según la doc de SubscriptionPurchaseV2. OJO con
 * CANCELED: es "canceled but not expired yet" — el usuario pagó hasta
 * expiryTime y la propia doc dice de usar lineItems.expiry_time para saber si
 * aún tiene acceso. Cortar premium al cancelar sería revocar un periodo pagado.
 * Los demás (PENDING, PAUSED, ON_HOLD, EXPIRED, REVOKED…) no dan acceso.
 */
const ACCESS_GRANTING_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED',
]);

/**
 * Normaliza la respuesta de purchases.subscriptionsv2.get. Si se indica
 * `expectedProductId` SOLO sirve el lineItem de ese producto: un mismatch
 * (token de otro producto) no concede — sin fallback al primer item, que
 * enmascararía el error.
 */
export function normalizeSubscription(
  payload: SubscriptionV2Payload,
  expectedProductId?: string
): NormalizedSubscription {
  const state = payload.subscriptionState ?? '';
  const item = expectedProductId
    ? payload.lineItems?.find((li) => li.productId === expectedProductId)
    : payload.lineItems?.[0];
  // getTime() para no propagar un Invalid Date si Google enviara basura.
  const expiryMs = item?.expiryTime ? new Date(item.expiryTime).getTime() : Number.NaN;
  const expiresAt = Number.isFinite(expiryMs) ? new Date(expiryMs) : null;
  const active = ACCESS_GRANTING_STATES.has(state) && expiresAt !== null;
  return { kind: 'subscription', valid: active, active, expiresAt };
}

/** Normaliza la respuesta de purchases.products.get (compra única). */
export function normalizeProduct(payload: ProductPurchasePayload): NormalizedProduct {
  // Enum oficial de ProductPurchase.purchaseState: 0 = Purchased,
  // 1 = Canceled, 2 = Pending. Solo 0 concede.
  const purchased = payload.purchaseState === 0;
  return { kind: 'product', valid: purchased, purchased };
}

// ── Llamadas HTTP ────────────────────────────────────────────────────────────

/**
 * Log seguro: abrevia el purchaseToken del path a 8 chars (suficiente para
 * correlacionar un incidente sin volar el token completo al log).
 */
function safeUrlForLog(url: string): string {
  return url.replace(/(tokens\/)([^/?]{8})[^/?]*/g, '$1$2…').split('?')[0] ?? url;
}

async function playGet(url: string): Promise<unknown> {
  const token = await getAccessToken();
  const packageName = process.env['GOOGLE_PLAY_PACKAGE_NAME'] ?? 'eu.sticklive.app';
  let res: Response;
  try {
    res = await fetch(url.replace('{packageName}', packageName), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (err) {
    if (isTimeoutError(err)) throw new PlayApiError(0, 'play_api_error: timeout');
    throw err;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.error({ status: res.status, url: safeUrlForLog(url), detail }, '[play] api error');
    throw new PlayApiError(res.status, `play_api_error: google respondió ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    // 200 con cuerpo no-JSON: no dejar escapar un SyntaxError crudo.
    throw new PlayApiError(res.status, 'play_api_error: respuesta no válida');
  }
}

/**
 * purchases.subscriptionsv2.get. En la REST real el token es PATH param
 * (`.../purchases/subscriptionsv2/tokens/{token}`), no query string.
 */
export async function getSubscription(
  purchaseToken: string,
  productId: string
): Promise<NormalizedSubscription> {
  const url = `${API_BASE}/{packageName}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  return normalizeSubscription((await playGet(url)) as unknown as SubscriptionV2Payload, productId);
}

/**
 * purchases.products.get (compra única lifetime). Doc: productId y token son
 * PATH params (`.../purchases/products/{productId}/tokens/{token}`).
 */
export async function getProduct(
  purchaseToken: string,
  productId: string
): Promise<NormalizedProduct> {
  const url = `${API_BASE}/{packageName}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  return normalizeProduct((await playGet(url)) as unknown as ProductPurchasePayload);
}

/**
 * purchases.voidedpurchases.list (reembolsos; el reconciler lo usa).
 *   - `type=1`: la doc dice que el default (0) SOLO devuelve productos in-app;
 *     con 1 se incluyen también suscripciones (sus renovales comparten
 *     purchaseToken, y el match por token del reconciler es idempotente).
 *   - Paginación con `pageSelection.token` (param oficial de la doc, fuente:
 *     `tokenPagination.nextPageToken`), con tope de 10 páginas por seguridad.
 */
export async function listVoidedPurchases(): Promise<Array<{ purchaseToken: string | null }>> {
  const out: Array<{ purchaseToken: string | null }> = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    pages += 1;
    const qs = new URLSearchParams({ type: '1' });
    if (pageToken) qs.set('pageSelection.token', pageToken);
    const json = (await playGet(
      `${API_BASE}/{packageName}/purchases/voidedpurchases?${qs.toString()}`
    )) as unknown as VoidedPurchasesPage;
    for (const v of json.voidedPurchases ?? []) {
      out.push({ purchaseToken: v.purchaseToken ?? null });
    }
    pageToken = json.tokenPagination?.nextPageToken;
  } while (pageToken && pages < MAX_VOIDED_PAGES);
  if (pageToken) {
    // Solo llegamos aquí si el tope cortó el bucle con páginas pendientes.
    logger.warn(
      { pages: MAX_VOIDED_PAGES },
      '[play] voidedpurchases: tope de páginas alcanzado — puede haber reembolsos sin procesar'
    );
  }
  return out;
}
