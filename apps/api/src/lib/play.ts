/**
 * Cliente de la Google Play Developer API (androidpublisher v3) SIN
 * dependencias: service account → JWT RS256 (node:crypto) → access token,
 * con caché en memoria. Módulo importable sin credenciales: si faltan,
 * cada llamada falla EXPLÍCITA (play_not_configured) — nunca silencio.
 *
 * Referencia (shapes verificados contra la doc oficial el 2026-10-06):
 * https://developers.google.com/android-publisher/api-ref/rest
 */
import { createSign } from 'node:crypto';

import { logger } from '@sports/logger';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';

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

/** Access token con caché (margen de 60 s). Falla explícito sin credenciales. */
export async function getAccessToken(
  creds: PlayCredentials = getPlayCredentials()
): Promise<string> {
  if (!creds.email || !creds.privateKey) {
    throw new Error(
      'play_not_configured: faltan GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL / GOOGLE_PLAY_PRIVATE_KEY'
    );
  }
  if (cached && cached.expiresAtMs > Date.now() + 60_000) return cached.token;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: buildPlayJwt(creds),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.error({ status: res.status, detail }, '[play] token error');
    throw new Error(`play_token_error: google respondió ${res.status}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('play_token_error: respuesta sin access_token');
  cached = {
    token: json.access_token,
    expiresAtMs: Date.now() + (json.expires_in ?? 3_600) * 1_000,
  };
  return cached.token;
}

/** Exportada SOLO para tests (misma lógica, permite inyectar credenciales). */
export const getAccessTokenForTest = getAccessToken;

// ── Normalización (pura) ─────────────────────────────────────────────────────

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
  payload: {
    subscriptionState?: string;
    lineItems?: Array<{ productId?: string; expiryTime?: string }>;
  },
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
export function normalizeProduct(payload: { purchaseState?: number }): NormalizedProduct {
  // Enum oficial de ProductPurchase.purchaseState: 0 = Purchased,
  // 1 = Canceled, 2 = Pending. Solo 0 concede.
  const purchased = payload.purchaseState === 0;
  return { kind: 'product', valid: purchased, purchased };
}

// ── Llamadas HTTP ────────────────────────────────────────────────────────────

async function playGet(url: string): Promise<unknown> {
  const token = await getAccessToken();
  const packageName = process.env['GOOGLE_PLAY_PACKAGE_NAME'] ?? 'eu.sticklive.app';
  const res = await fetch(url.replace('{packageName}', packageName), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.error({ status: res.status, url: url.split('?')[0], detail }, '[play] api error');
    throw new Error(`play_api_error: google respondió ${res.status}`);
  }
  return res.json();
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
  return normalizeSubscription((await playGet(url)) as never, productId);
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
  return normalizeProduct((await playGet(url)) as never);
}

/**
 * purchases.voidedpurchases.list (reembolsos; el reconciler lo usa).
 * `type=1`: la doc dice que el default (0) SOLO devuelve productos in-app;
 * con 1 se incluyen también suscripciones (sus renovales comparten
 * purchaseToken, y el match por token del reconciler es idempotente).
 */
export async function listVoidedPurchases(): Promise<Array<{ purchaseToken: string | null }>> {
  const url = `${API_BASE}/{packageName}/purchases/voidedpurchases?type=1`;
  const json = (await playGet(url)) as {
    voidedPurchases?: Array<{ purchaseToken?: string }>;
  };
  return (json.voidedPurchases ?? []).map((v) => ({ purchaseToken: v.purchaseToken ?? null }));
}
