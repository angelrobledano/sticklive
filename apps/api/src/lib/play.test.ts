import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVerify, generateKeyPairSync } from 'node:crypto';

import { logger } from '@sports/logger';
import {
  buildPlayJwt,
  getAccessToken,
  getProduct,
  getSubscription,
  listVoidedPurchases,
  normalizeProduct,
  normalizeSubscription,
  resetTokenCacheForTest,
} from './play.js';

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

  it('mismatch de producto NO concede (token de otro producto) — y el match sí', () => {
    // Crítico de ingresos: pedir premium_lifetime con el token de una suscripción
    // annual no debe conceder NADA (sin fallback al primer lineItem).
    const payload = {
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      lineItems: [{ productId: 'premium_annual', expiryTime: '2030-01-01T00:00:00Z' }],
    };
    expect(normalizeSubscription(payload, 'premium_lifetime').valid).toBe(false);
    expect(normalizeSubscription(payload, 'premium_annual').valid).toBe(true);
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
    // La caché es module-level: vaciarla entre tests evita orden-dependencia.
    resetTokenCacheForTest();
  });

  it('falla explícito si no hay credenciales configuradas', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { getAccessTokenForTest } = await import('./play.js');
    await expect(getAccessTokenForTest({ email: '', privateKey: '' })).rejects.toThrow(
      /play_not_configured/i
    );
  });

  it('cachea el token: dos llamadas seguidas → UN solo fetch', async () => {
    resetTokenCacheForTest();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 't1', expires_in: 3600 }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const creds = { email: 'sa@x', privateKey: PRIVATE_KEY };
    await expect(getAccessToken(creds)).resolves.toBe('t1');
    await expect(getAccessToken(creds)).resolves.toBe('t1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('expires_in 0 no supera el margen de 60 s → el segundo fetch repite', async () => {
    resetTokenCacheForTest();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 't2', expires_in: 0 }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const creds = { email: 'sa@x', privateKey: PRIVATE_KEY };
    await expect(getAccessToken(creds)).resolves.toBe('t2');
    await expect(getAccessToken(creds)).resolves.toBe('t2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('cliente HTTP (fetch stubbed)', () => {
  beforeEach(() => {
    // playGet resuelve credenciales de env (getPlayCredentials): stub para que
    // el flujo llegue al fetch stubbed en lugar de play_not_configured.
    vi.stubEnv('GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL', 'sa@test.iam.gserviceaccount.com');
    vi.stubEnv('GOOGLE_PLAY_PRIVATE_KEY', PRIVATE_KEY);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetTokenCacheForTest();
  });

  /** Fetch que resuelve el token OAuth y, para androidpublisher, `api`. */
  function stubFetch(api: () => Record<string, unknown>): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (String(input).includes('oauth2.googleapis.com')) {
          return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
        }
        return api();
      })
    );
  }

  it('construye las URLs oficiales (token y productId como path params)', async () => {
    vi.stubEnv('GOOGLE_PLAY_PACKAGE_NAME', 'com.test.app');
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const u = String(input);
        urls.push(u);
        if (u.includes('oauth2.googleapis.com')) {
          return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
        }
        return { ok: true, json: async () => ({}) };
      })
    );

    await getSubscription('tok con espacio', 'premium_annual');
    expect(urls).toContain(
      'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.test.app/purchases/subscriptionsv2/tokens/tok%20con%20espacio'
    );

    await getProduct('t', 'p');
    expect(urls).toContain(
      'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.test.app/purchases/products/p/tokens/t'
    );
  });

  it('el log de error abrevia el token de la URL (8 chars, sin volar el token completo)', async () => {
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const fullToken = 'abcdef1234567890SECRET';
    stubFetch(() => ({ ok: false, status: 500, text: async () => 'boom' }));
    await expect(getSubscription(fullToken, 'premium_annual')).rejects.toMatchObject({
      name: 'PlayApiError',
      status: 500,
    });
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).not.toContain(fullToken);
    expect(logged).toContain(fullToken.slice(0, 8));
    errSpy.mockRestore();
  });

  it('timeout del fetch sale como play_api_error: timeout (PlayApiError, status 0)', async () => {
    stubFetch(() => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    await expect(getSubscription('tok-x', 'premium_annual')).rejects.toMatchObject({
      name: 'PlayApiError',
      status: 0,
      message: 'play_api_error: timeout',
    });
  });

  it('voidedpurchases pagina con pageSelection.token y agrega todas las páginas', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const u = String(input);
        urls.push(u);
        if (u.includes('oauth2.googleapis.com')) {
          return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
        }
        if (u.includes('pageSelection.token=PAGE2')) {
          return { ok: true, json: async () => ({ voidedPurchases: [{ purchaseToken: 'b2' }] }) };
        }
        return {
          ok: true,
          json: async () => ({
            voidedPurchases: [{ purchaseToken: 'b1' }, {}],
            tokenPagination: { nextPageToken: 'PAGE2' },
          }),
        };
      })
    );
    await expect(listVoidedPurchases()).resolves.toEqual([
      { purchaseToken: 'b1' },
      { purchaseToken: null },
      { purchaseToken: 'b2' },
    ]);
    expect(urls.some((u) => u.includes('pageSelection.token=PAGE2'))).toBe(true);
  });

  it('voidedpurchases: tope de 10 páginas con warn explícito (puede quedar reembolso sin procesar)', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    stubFetch(() => ({
      ok: true,
      json: async () => ({
        voidedPurchases: [{ purchaseToken: 'x' }],
        tokenPagination: { nextPageToken: 'next' },
      }),
    }));
    await expect(listVoidedPurchases()).resolves.toHaveLength(10);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ pages: 10 }),
      expect.stringContaining('sin procesar')
    );
    warnSpy.mockRestore();
  });
});
