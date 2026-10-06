import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVerify, generateKeyPairSync } from 'node:crypto';

import { buildPlayJwt, normalizeProduct, normalizeSubscription } from './play.js';

// El cliente de Play no se toca en unit: se testean las piezas PURAS
// (JWT, normalización) — las llamadas HTTP se validan en el test de la ruta
// con el módulo mockeado.

// node:crypto se niega a firmar con un PEM falso (lanza ANTES de las
// aserciones), así que generamos un par RSA real: el contrato es el mismo
// (RS256, claims correctos) y además verificamos la firma criptográficamente.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('buildPlayJwt', () => {
  it('firma RS256 con header/claims correctos', () => {
    const jwt = buildPlayJwt({
      email: 'sa@sticklive.iam.gserviceaccount.com',
      privateKey: PRIVATE_KEY,
      nowSec: 1_000_000,
    });
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString('utf8'))).toEqual({
      alg: 'RS256',
      typ: 'JWT',
      kid: undefined,
    });
    const claims = JSON.parse(
      Buffer.from(p!, 'base64url').toString('utf8')
    ) as Record<string, unknown>;
    expect(claims['iss']).toBe('sa@sticklive.iam.gserviceaccount.com');
    expect(claims['scope']).toBe('https://www.googleapis.com/auth/androidpublisher');
    expect(claims['aud']).toBe('https://oauth2.googleapis.com/token');
    expect(claims['exp']).toBe(1_000_000 + 3_600);
    expect(claims['iat']).toBe(1_000_000);
    expect(typeof s).toBe('string');
    expect(s!.length).toBeGreaterThan(0);
    // La firma verifica contra la clave pública (RS256 real, no una cadena cualquiera).
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${h}.${p}`);
    expect(verifier.verify(publicKey, s!, 'base64url')).toBe(true);
  });
});

describe('normalizeSubscription (androidpublisher v3)', () => {
  it('activo con renovación automática', () => {
    const n = normalizeSubscription({
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      lineItems: [{ productId: 'premium_annual', expiryTime: '2030-01-01T00:00:00Z' }],
    });
    expect(n.valid).toBe(true);
    expect(n.active).toBe(true);
    expect(n.expiresAt?.toISOString()).toBe('2030-01-01T00:00:00.000Z');
  });

  it('en grace period cuenta como activo (el usuario pagó)', () => {
    const n = normalizeSubscription({
      subscriptionState: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
      lineItems: [{ expiryTime: '2030-01-01T00:00:00Z' }],
    });
    expect(n.valid).toBe(true);
    expect(n.active).toBe(true);
  });

  it('expirada/cancelada-definitiva/on-hold no es válida para conceder', () => {
    for (const state of [
      'SUBSCRIPTION_STATE_EXPIRED',
      'SUBSCRIPTION_STATE_CANCELED',
      'SUBSCRIPTION_STATE_ON_HOLD',
    ]) {
      const n = normalizeSubscription({ subscriptionState: state, lineItems: [] });
      expect(n.valid).toBe(false);
      expect(n.active).toBe(false);
    }
  });

  it('cancelada pero NO expirada conserva acceso hasta expiryTime (doc oficial: "canceled but not expired yet")', () => {
    const n = normalizeSubscription({
      subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
      lineItems: [{ productId: 'premium_annual', expiryTime: '2030-01-01T00:00:00Z' }],
    });
    expect(n.valid).toBe(true);
    expect(n.active).toBe(true);
    expect(n.expiresAt?.toISOString()).toBe('2030-01-01T00:00:00.000Z');
  });

  it('sin lineItems no concede', () => {
    expect(
      normalizeSubscription({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', lineItems: [] }).valid
    ).toBe(false);
  });

  it('expiryTime no parseable no concede (ni propaga Invalid Date)', () => {
    const n = normalizeSubscription({
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      lineItems: [{ expiryTime: 'no-es-una-fecha' }],
    });
    expect(n.valid).toBe(false);
    expect(n.expiresAt).toBeNull();
  });
});

describe('normalizeProduct (compra única)', () => {
  it('purchaseState 0 = comprada y válida', () => {
    const n = normalizeProduct({ purchaseState: 0 });
    expect(n.valid).toBe(true);
    expect(n.purchased).toBe(true);
  });

  it('cancelada (1) y pendiente (2) no conceden (enum oficial: 0 comprada, 1 canceled, 2 pending)', () => {
    expect(normalizeProduct({ purchaseState: 1 }).valid).toBe(false);
    expect(normalizeProduct({ purchaseState: 2 }).valid).toBe(false);
  });
});

describe('getAccessToken (cache + error explícito)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falla explícito si no hay credenciales configuradas', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { getAccessTokenForTest } = await import('./play.js');
    await expect(getAccessTokenForTest({ email: '', privateKey: '' })).rejects.toThrow(
      /play_not_configured/i
    );
  });
});
