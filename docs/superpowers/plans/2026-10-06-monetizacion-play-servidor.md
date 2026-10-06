# Monetización (1/3) — Servidor de premium Google Play: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la API conceda y mantenga premium (anual + lifetime) validando compras de Google Play, con el mismo rigor que el flujo Stripe existente.

**Architecture:** Nueva migración aditiva (`users.premium_lifetime` + `play_purchases` con idempotencia por token), cliente sin dependencias de la Google Play Developer API (JWT de service account firmado con `node:crypto`), endpoint `POST /payments/play/verify` autenticado con `userFromBearer` (misma sesión Bearer que auth/push), y job diario `play-reconcile` en el scheduler del ETL (patrón `partition-guard`: entrada standalone sin lock del scraping). El entitlement sigue siendo UNO: `isPremiumActive` pasa a ser `premium_lifetime || premium_until > NOW()`.

**Tech Stack:** Hono + `@sports/db` (pg), `node:crypto` (RS256 para el JWT de Google), vitest (unit) + Postgres real (integración), scheduler shell existente.

**Por qué dividimos la monetización en 3 planes** (spec `2026-10-06-monetizacion-ads-premium-design.md`):
1. **Este plan (A — servidor):** produce software funcionable y verificable por sí solo (migraciones + verify + reconciler, todo testeado).
2. Plan B (app — compra): `react-native-iap`, pantalla premium, canje contra `/verify`.
3. Plan C (app — publicidad): AdMob + UMP + banners con el guard de premium ya disponible.

**Contexto crítico descubierto en la auditoría (no está en el spec):**
- La identidad premium es **por dispositivo**: `users.device_id` es la clave; el login Google (canje de código, Task 3.1 del plan de la app) enlaza email↔dispositivo. "Requiere sesión" ⇒ exigir Bearer válido (usuario con cuenta enlazada); el entitlement viaja a la web porque ambas superficies resuelven la MISMA fila `users`.
- El patrón a imitar es `apps/api/src/routes/payments-stripe.ts` (webhook idempotente en una transacción, analítica FUERA de la transacción, errores explícitos con envelope `{ error: code }`).
- `lib/play.ts` sigue la regla del repo de no añadir dependencias sin valor: el flujo JWT→token de Google son ~40 líneas con `node:crypto`.

**Advertencia de API externa:** los shapes de `androidpublisher v3` que usa este plan (`subscriptionState`, `lineItems[].autoRenewingPlan`, `purchaseState`, `voidedPurchases`) son estables, pero antes de implementar Task 3 verificar contra la referencia oficial (https://developers.google.com/android-publisher/api-ref/rest) — criterio "los docs instalados/actuales mandan sobre el entrenamiento".

---

## Estructura de ficheros

```
packages/db/migrations/070_premium_play.sql          # nueva
packages/db/src/queries/play-purchases.ts            # nueva (queries de play_purchases)
apps/api/src/lib/premium.ts                          # modificada (+lifetime, +isUserPremium)
apps/api/src/lib/play.ts                             # nueva (cliente Play Developer API)
apps/api/src/lib/env.ts                              # modificada (RECOMMENDED_PROD)
apps/api/src/routes/payments-play.ts                 # nueva (verify + status)
apps/api/src/index.ts                                # modificada (montar router)
apps/api/src/lib/premium.test.ts                     # modificada (casos lifetime)
apps/api/src/lib/play.test.ts                        # nueva
apps/api/src/routes/payments-play.test.ts            # nueva
apps/etl/src/play-reconcile.ts                       # nueva (job diario)
tests/integration/play-verify.test.ts                # nueva (integración, Postgres real)
deploy/etl-scheduler.sh                              # modificada (entrada diaria)
```

NO se toca: `payments-stripe.ts` (solo se amplía su respuesta de `status`), `users` queries existentes.

---

### Task 1: Migración 070 — `premium_lifetime` + `play_purchases`

**Files:**
- Create: `packages/db/migrations/070_premium_play.sql`
- Create: `packages/db/src/queries/play-purchases.ts`

- [ ] **Step 1: Escribir la migración (idempotente, sin tocar datos existentes)**

```sql
-- 070_premium_play.sql
-- Monetización: premium de Google Play (anual por suscripción + lifetime por
-- compra única). El guard autoritativo pasa a ser:
--   premium_lifetime OR premium_until > NOW()
-- (auditoría S9: is_premium nunca se revierte y NO es fuente de verdad).

-- El "para siempre" de la compra única en Play. NULL/FALSE = no lifetime
-- (NO cambiar la semántica de premium_until: los usuarios gratis ya tienen NULL).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS premium_lifetime BOOLEAN NOT NULL DEFAULT FALSE;

-- Registro de compras Play, idempotente por purchase_token (patrón
-- processed_stripe_events: UNIQUE + ON CONFLICT). state refleja lo que dice
-- Google, revalidado por el job diario play-reconcile.
CREATE TABLE IF NOT EXISTS play_purchases (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id),
  product_id     TEXT NOT NULL CHECK (product_id IN ('premium_annual', 'premium_lifetime')),
  purchase_token TEXT NOT NULL UNIQUE,
  order_id       TEXT,
  state          TEXT NOT NULL CHECK (state IN ('active', 'expired', 'revoked')),
  expires_at     TIMESTAMPTZ,              -- NULL en lifetime
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_play_purchases_user
  ON play_purchases (user_id);

-- El reconciler busca suscripciones anuales activas que revalidar.
CREATE INDEX IF NOT EXISTS idx_play_purchases_active_annual
  ON play_purchases (expires_at)
  WHERE state = 'active' AND product_id = 'premium_annual';
```

- [ ] **Step 2: Verificar la migración contra Postgres real (dos veces: idempotente)**

```powershell
npm run test:integration:docker
```

Expected: migraciones desde cero PASS y la reaplicación también (el runner del repo ya reaplica). Si el compose de test no está disponible, mínimo: `npm run db:migrate` contra la BD de desarrollo local, dos veces.

- [ ] **Step 3: Queries de play_purchases**

Crear `packages/db/src/queries/play-purchases.ts`:

```ts
import { db } from '../client.js';

export type PlayProductId = 'premium_annual' | 'premium_lifetime';
export type PlayPurchaseState = 'active' | 'expired' | 'revoked';

export interface DbPlayPurchase {
  id: string;
  user_id: string;
  product_id: PlayProductId;
  purchase_token: string;
  order_id: string | null;
  state: PlayPurchaseState;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Dueño del token, para la idempotencia/carrera de /verify. */
export async function findPurchaseByToken(
  purchaseToken: string
): Promise<DbPlayPurchase | null> {
  const res = await db.query<DbPlayPurchase>(
    'SELECT * FROM play_purchases WHERE purchase_token = $1',
    [purchaseToken]
  );
  return res.rows[0] ?? null;
}

/** Suscripciones anuales activas que el reconciler debe revalidar. */
export async function listActiveAnnualPurchases(): Promise<DbPlayPurchase[]> {
  const res = await db.query<DbPlayPurchase>(
    `SELECT * FROM play_purchases
      WHERE state = 'active' AND product_id = 'premium_annual'
      ORDER BY expires_at NULLS LAST`
  );
  return res.rows;
}

/** Compras lifetime activas (para reembolsos vía voidedpurchases). */
export async function listActiveLifetimePurchases(): Promise<DbPlayPurchase[]> {
  const res = await db.query<DbPlayPurchase>(
    `SELECT * FROM play_purchases
      WHERE state = 'active' AND product_id = 'premium_lifetime'`
  );
  return res.rows;
}
```

- [ ] **Step 4: Typecheck del paquete db**

```powershell
npm run typecheck --workspace=@sports/db
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/db/migrations/070_premium_play.sql packages/db/src/queries/play-purchases.ts
git commit -m "feat(db): migracion 070 premium_lifetime + play_purchases (idempotente por token)"
```

---

### Task 2: Guard único con lifetime (`lib/premium.ts`)

**Files:**
- Modify: `apps/api/src/lib/premium.ts`
- Modify: `apps/api/src/lib/premium.test.ts`

- [ ] **Step 1: Añadir los tests primero (TDD — deben fallar)**

En `apps/api/src/lib/premium.test.ts`, añadir dentro del `describe` existente (o en uno nuevo al final del fichero):

```ts
describe('isUserPremium (lifetime)', () => {
  it('lifetime concede aunque premium_until esté en el pasado', () => {
    expect(
      isUserPremium({ premiumLifetime: true, premiumUntil: '2020-01-01T00:00:00Z' })
    ).toBe(true);
  });

  it('lifetime NULL/FALSE mantiene la regla premium_until', () => {
    expect(isUserPremium({ premiumLifetime: false, premiumUntil: null })).toBe(false);
    expect(
      isUserPremium({ premiumLifetime: null, premiumUntil: farFutureIso() })
    ).toBe(true);
  });

  it('usuario null nunca es premium', () => {
    expect(isUserPremium(null)).toBe(false);
    expect(isUserPremium(undefined)).toBe(false);
  });
});
```

Si el test existente usa helpers locales (p. ej. `farFutureIso()`), reutilízalos; si no, sustitúyelo por un ISO futuro literal (p. ej. `'2099-01-01T00:00:00Z'`). Añadir `isUserPremium` al import existente de `./premium.js`.

- [ ] **Step 2: Ejecutar y verificar que falla**

```powershell
npm run test --workspace=@sports/api
```

Expected: FAIL — `isUserPremium` no está exportada.

- [ ] **Step 3: Implementar en `lib/premium.ts` (mínimo para pasar)**

Añadir al final del fichero (NO tocar `isPremiumActive`, `isCheckoutSessionId` ni `isPaidCheckoutSession`):

```ts
/** Campos de usuario relevantes para el guard (subconjunto de users). */
export interface PremiumFields {
  premiumUntil?: string | Date | null;
  premiumLifetime?: boolean | null;
}

/**
 * Guard ÚNICO de premium para todas las superficies (web y app): lifetime
 * (compra única Play) o suscripción vigente. `isPremiumActive` sigue siendo
 * la regla de caducidad; esto solo añade el OR del lifetime (spec §4).
 */
export function isUserPremium(
  user: PremiumFields | null | undefined,
  now: Date = new Date()
): boolean {
  if (!user) return false;
  if (user.premiumLifetime) return true;
  return isPremiumActive(user.premiumUntil, now);
}
```

- [ ] **Step 4: Ejecutar tests y verificar que pasan**

```powershell
npm run test --workspace=@sports/api
```

Expected: PASS (los nuevos + los existentes intactos).

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/lib/premium.ts apps/api/src/lib/premium.test.ts
git commit -m "feat(api): isUserPremium con lifetime en el guard unico (spec monetizacion 4)"
```

---

### Task 3: Cliente de la Google Play Developer API (`lib/play.ts`)

**Files:**
- Create: `apps/api/src/lib/play.ts`
- Create: `apps/api/src/lib/play.test.ts`

- [ ] **Step 1: Escribir los tests primero (deben fallar)**

Crear `apps/api/src/lib/play.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildPlayJwt,
  normalizeSubscription,
  normalizeProduct,
} from './play.js';

// El cliente de Play no se toca en unit: se testean las piezas PURAS
// (JWT, normalización) — las llamadas HTTP se validan en el test de la ruta
// con el módulo mockeado.

const PRIVATE_KEY = `-----BEGIN TEST KEY-----
no-es-una-clave-real
-----END TEST KEY-----`;

describe('buildPlayJwt', () => {
  it('firma RS256 con header/claims correctos', () => {
    const jwt = buildPlayJwt({
      email: 'sa@sticklive.iam.gserviceaccount.com',
      privateKey: PRIVATE_KEY,
      nowSec: 1_000_000,
    });
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url'))).toEqual({
      alg: 'RS256',
      typ: 'JWT',
      kid: undefined,
    });
    const claims = JSON.parse(Buffer.from(p!, 'base64url')) as Record<string, unknown>;
    expect(claims['iss']).toBe('sa@sticklive.iam.gserviceaccount.com');
    expect(claims['scope']).toBe('https://www.googleapis.com/auth/androidpublisher');
    expect(claims['aud']).toBe('https://oauth2.googleapis.com/token');
    expect(claims['exp']).toBe(1_000_000 + 3_600);
    expect(claims['iat']).toBe(1_000_000);
    expect(typeof s).toBe('string');
    expect(s!.length).toBeGreaterThan(0);
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

  it('expirada/cancelada no es válida para conceder', () => {
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

  it('sin lineItems no concede', () => {
    expect(normalizeSubscription({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', lineItems: [] }).valid).toBe(false);
  });
});

describe('normalizeProduct (compra única)', () => {
  it('purchaseState 0 = comprada y válida', () => {
    const n = normalizeProduct({ purchaseState: 0 });
    expect(n.valid).toBe(true);
    expect(n.purchased).toBe(true);
  });

  it('pendiente (1) y cancelada (2) no conceden', () => {
    expect(normalizeProduct({ purchaseState: 1 }).valid).toBe(false);
    expect(normalizeProduct({ purchaseState: 2 }).valid).toBe(false);
  });
});

describe('getAccessToken (cache + error explícito)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falla explícito si no hay credenciales configuradas', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { getAccessTokenForTest } = await import('./play.js');
    await expect(getAccessTokenForTest({ email: '', privateKey: '' })).rejects.toThrow(/play_not_configured/i);
  });
});
```

NOTA: si al ejecutar el import del módulo éste valida env en carga, mueve la validación a las funciones (no en top-level) — el módulo debe importarse sin credenciales (la API arranca sin Play configurada; igual que Stripe).

- [ ] **Step 2: Ejecutar y verificar que falla**

```powershell
npm run test --workspace=@sports/api
```

Expected: FAIL — el módulo `./play.js` no existe.

- [ ] **Step 3: Implementar `lib/play.ts`**

```ts
/**
 * Cliente de la Google Play Developer API (androidpublisher v3) SIN
 * dependencias: service account → JWT RS256 (node:crypto) → access token,
 * con caché en memoria. Módulo importable sin credenciales: si faltan,
 * cada llamada falla EXPLÍCITA (play_not_configured) — nunca silencio.
 *
 * Referencia: https://developers.google.com/android-publisher/api-ref/rest
 */
import crypto from 'node:crypto';

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

/** JWT firmado (puro, testeable). exp a 1 h; Google acepta ≤ 1 h. */
export function buildPlayJwt(creds: PlayCredentials, nowSec: number = Math.floor(Date.now() / 1000)): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: creds.email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3_600,
  };
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const input = `${b64url(header)}.${b64url(claims)}`;
  const signer = crypto.createSign('RSA-SHA256');
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
export async function getAccessToken(creds: PlayCredentials = getPlayCredentials()): Promise<string> {
  if (!creds.email || !creds.privateKey) {
    throw new Error('play_not_configured: faltan GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL / GOOGLE_PLAY_PRIVATE_KEY');
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
  valid: boolean;     // puede conceder premium AHORA
  active: boolean;    // activa o en grace period
  expiresAt: Date | null;
}

export interface NormalizedProduct {
  kind: 'product';
  valid: boolean;     // purchaseState 0
  purchased: boolean;
}

const ACTIVE_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
]);

export function normalizeSubscription(payload: {
  subscriptionState?: string;
  lineItems?: Array<{ productId?: string; expiryTime?: string }>;
}, expectedProductId?: string): NormalizedSubscription {
  const state = payload.subscriptionState ?? '';
  const item = payload.lineItems?.find((li) => !expectedProductId || li.productId === expectedProductId)
    ?? payload.lineItems?.[0];
  const expiresAt = item?.expiryTime ? new Date(item.expiryTime) : null;
  const active = ACTIVE_STATES.has(state) && Boolean(expiresAt);
  return { kind: 'subscription', valid: active, active, expiresAt };
}

export function normalizeProduct(payload: { purchaseState?: number }): NormalizedProduct {
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

/** purchases.subscriptionsv2.get */
export async function getSubscription(purchaseToken: string, productId: string): Promise<NormalizedSubscription> {
  const url = `${API_BASE}/{packageName}/purchases/subscriptionsv2/get?token=${encodeURIComponent(purchaseToken)}`;
  return normalizeSubscription((await playGet(url)) as never, productId);
}

/** purchases.products.get (compra única lifetime) */
export async function getProduct(purchaseToken: string, _productId: string): Promise<NormalizedProduct> {
  const url = `${API_BASE}/{packageName}/purchases/products/get?token=${encodeURIComponent(purchaseToken)}&productId=${encodeURIComponent(_productId)}`;
  return normalizeProduct((await playGet(url)) as never);
}

/** purchases.voidedpurchases.list (reembolsos; el reconciler lo usa para lifetime) */
export async function listVoidedPurchases(): Promise<Array<{ purchaseToken: string | null }>> {
  const url = `${API_BASE}/{packageName}/purchases/voidedpurchases/list`;
  const json = (await playGet(url)) as {
    voidedPurchases?: Array<{ purchaseToken?: string }>;
  };
  return (json.voidedPurchases ?? []).map((v) => ({ purchaseToken: v.purchaseToken ?? null }));
}
```

- [ ] **Step 4: Tests en verde**

```powershell
npm run test --workspace=@sports/api
```

Expected: PASS. Si algún shape no cuadra con la referencia oficial de androidpublisher v3 (paso 0 de este plan), corregir la normalización — los tests describen el contrato, no al revés.

- [ ] **Step 5: Commit**

```powershell
git add apps/api/src/lib/play.ts apps/api/src/lib/play.test.ts
git commit -m "feat(api): cliente Play Developer API sin dependencias (JWT service account)"
```

---

### Task 4: `POST /payments/play/verify` + `GET /payments/play/status`

**Files:**
- Create: `apps/api/src/routes/payments-play.ts`
- Create: `apps/api/src/routes/payments-play.test.ts`
- Modify: `apps/api/src/index.ts` (import + montar router)
- Modify: `apps/api/src/lib/env.ts` (RECOMMENDED_PROD)

- [ ] **Step 1: Tests primero (deben fallar)**

Crear `apps/api/src/routes/payments-play.test.ts`. Revisar `payments-stripe.test.ts` para copiar su setup de la app Hono (mismos helpers de env del router). Contenido mínimo del contrato:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock del cliente Play y de la BD (mismo enfoque que payments-stripe.test.ts).
vi.mock('../../src/lib/play.js', () => ({
  getSubscription: vi.fn(),
  getProduct: vi.fn(),
}));

vi.mock('@sports/db', () => ({
  db: { query: vi.fn() },
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn({
    query: vi.fn(),
  })),
}));

// userFromBearer mockeado: el router lo importa de session-lookup.js
vi.mock('../lib/session-lookup.js', () => ({
  userFromBearer: vi.fn(),
}));

import { playRouter } from './payments-play.js';
import { Hono } from 'hono';
import { getSubscription, getProduct } from '../../src/lib/play.js';
import { userFromBearer } from '../lib/session-lookup.js';

// NOTA para el implementador: los mocks de db.query se configuran por test con
// vi.mocked(db.query).mockResolvedValueOnce(...). El router NO debe depender de
// un orden de queries frágil: si lo necesita, testear con la integración real
// (Task 6) y aquí solo los caminos puros (validación de entrada y 401).

describe('POST /payments/play/verify (validación de entrada)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 sin sesión', async () => {
    vi.mocked(userFromBearer).mockResolvedValue(null);
    const app = new Hono().route('/payments/play', playRouter);
    const res = await app.request('/payments/play/verify', {
      method: 'POST',
      body: JSON.stringify({ purchaseToken: 'tok', productId: 'premium_lifetime' }),
    });
    expect(res.status).toBe(401);
  });

  it('400 sin purchaseToken', async () => {
    vi.mocked(userFromBearer).mockResolvedValue({ id: 'u1' });
    const app = new Hono().route('/payments/play', playRouter);
    const res = await app.request('/payments/play/verify', {
      method: 'POST',
      headers: { Authorization: 'Bearer x' },
      body: JSON.stringify({ productId: 'premium_lifetime' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing_purchase_token');
  });

  it('400 con producto desconocido', async () => {
    vi.mocked(userFromBearer).mockResolvedValue({ id: 'u1' });
    const app = new Hono().route('/payments/play', playRouter);
    const res = await app.request('/payments/play/verify', {
      method: 'POST',
      headers: { Authorization: 'Bearer x' },
      body: JSON.stringify({ purchaseToken: 'tok', productId: 'premium_semanal' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_product');
  });
});

describe('POST /payments/play/verify (concesión)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lifetime: producto válido concede premium_lifetime', async () => {
    vi.mocked(userFromBearer).mockResolvedValue({ id: 'u1' });
    vi.mocked(getProduct).mockResolvedValue({ kind: 'product', valid: true, purchased: true });
    const app = new Hono().route('/payments/play', playRouter);
    const res = await app.request('/payments/play/verify', {
      method: 'POST',
      headers: { Authorization: 'Bearer x' },
      body: JSON.stringify({ purchaseToken: 'tok-lifetime', productId: 'premium_lifetime' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.premium).toBe(true);
    expect(body.premiumLifetime).toBe(true);
  });

  it('anual: suscripción activa concede premium_until = expiración de Play', async () => {
    vi.mocked(userFromBearer).mockResolvedValue({ id: 'u1' });
    vi.mocked(getSubscription).mockResolvedValue({
      kind: 'subscription', valid: true, active: true, expiresAt: new Date('2030-01-01T00:00:00Z'),
    });
    const app = new Hono().route('/payments/play', playRouter);
    const res = await app.request('/payments/play/verify', {
      method: 'POST',
      headers: { Authorization: 'Bearer x' },
      body: JSON.stringify({ purchaseToken: 'tok-annual', productId: 'premium_annual' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.premium).toBe(true);
    expect(body.premiumUntil).toBe('2030-01-01T00:00:00.000Z');
  });

  it('compra no válida → 422 sin conceder nada', async () => {
    vi.mocked(userFromBearer).mockResolvedValue({ id: 'u1' });
    vi.mocked(getProduct).mockResolvedValue({ kind: 'product', valid: false, purchased: false });
    const app = new Hono().route('/payments/play', playRouter);
    const res = await app.request('/payments/play/verify', {
      method: 'POST',
      headers: { Authorization: 'Bearer x' },
      body: JSON.stringify({ purchaseToken: 'tok-bad', productId: 'premium_lifetime' }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('purchase_not_valid');
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

```powershell
npm run test --workspace=@sports/api
```

Expected: FAIL — `payments-play.js` no existe.

- [ ] **Step 3: Implementar el router**

Crear `apps/api/src/routes/payments-play.ts`:

```ts
import { Hono } from 'hono';
import { db, withTransaction } from '@sports/db';
import { logger } from '@sports/logger';
import { rateLimit } from '../lib/rate-limit.js';
import { captureRouteError } from '../lib/route-error.js';
import { isUserPremium } from '../lib/premium.js';
import { userFromBearer } from '../lib/session-lookup.js';
import { getSubscription, getProduct } from '../lib/play.js';

/**
 * Pagos con Google Play Billing — verificación SERVER-SIDE de compras hechas
 * en la app (spec monetización §5). La app compra con react-native-iap y
 * envía el purchaseToken aquí; la API valida contra Google y concede.
 *
 *   POST /payments/play/verify   { purchaseToken, productId } → entitlement
 *   GET  /payments/play/status   → estado premium autoritativo de la sesión
 *
 * Productos esperados (Play Console):
 *   premium_annual   → suscripción anual (purchases.subscriptionsv2.get)
 *   premium_lifetime → compra única no consumible (purchases.products.get)
 */

export const playRouter = new Hono();

const PRODUCTS = new Set(['premium_annual', 'premium_lifetime'] as const);
type ProductId = (typeof PRODUCTS extends Set<infer T> ? T : never);

async function requireUser(c: Parameters<Parameters<Hono['get']>[1]>[0]) {
  const user = await userFromBearer(c.req.header('Authorization'));
  if (!user) return null;
  return user;
}

async function entitlementOf(userId: string): Promise<{ premium: boolean; premiumUntil: string | null; premiumLifetime: boolean }> {
  const res = await db.query<{ premium_until: string | null; premium_lifetime: boolean }>(
    'SELECT premium_until, premium_lifetime FROM users WHERE id = $1',
    [userId]
  );
  const row = res.rows[0] ?? null;
  return {
    premium: isUserPremium(row ?? undefined),
    premiumUntil: row?.premium_until ?? null,
    premiumLifetime: row?.premium_lifetime ?? false,
  };
}

playRouter.post('/verify', rateLimit(20, 60_000), async (c) => {
  try {
    const user = await requireUser(c);
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    const body = await c.req.json<{ purchaseToken?: unknown; productId?: unknown }>().catch(() => ({}));
    const purchaseToken = body.purchaseToken;
    const productId = body.productId;
    if (typeof purchaseToken !== 'string' || purchaseToken.length < 8 || purchaseToken.length > 4096) {
      return c.json({ error: 'missing_purchase_token' }, 400);
    }
    if (typeof productId !== 'string' || !PRODUCTS.has(productId as ProductId)) {
      return c.json({ error: 'unknown_product' }, 400);
    }

    // Idempotencia: el token ya registrado para ESTE usuario → responder con
    // el estado actual (reintento benigno). Para OTRO usuario → 409 explícito.
    const existing = await db.query<{ user_id: string }>(
      'SELECT user_id FROM play_purchases WHERE purchase_token = $1',
      [purchaseToken]
    );
    if (existing.rows[0] && existing.rows[0].user_id !== user.id) {
      logger.warn({ userId: user.id }, '[play] token de compra reclamado por otra cuenta');
      return c.json({ error: 'token_owned_by_other_user' }, 409);
    }
    if (existing.rows[0]) {
      return c.json(await entitlementOf(user.id));
    }

    // Validar contra Google ANTES de tocar la BD. Un fallo de Google NUNCA
    // concede premium (502 explícito; la app ofrecerá reintentar).
    const verified = productId === 'premium_annual'
      ? await getSubscription(purchaseToken, productId)
      : await getProduct(purchaseToken, productId);
    if (!verified.valid) {
      logger.warn({ userId: user.id, productId }, '[play] compra no válida para conceder');
      return c.json({ error: 'purchase_not_valid' }, 422);
    }

    let premiumUntil: string | null = null;
    if (verified.kind === 'subscription') {
      premiumUntil = verified.expiresAt ? verified.expiresAt.toISOString() : null;
      if (!premiumUntil) return c.json({ error: 'purchase_not_valid' }, 422);
    }

    // Efecto + marca de idempotencia en UNA transacción: si el INSERT del token
    // choca (carrera de dos verifies paralelos), se revierte todo y se relee.
    let inserted = true;
    await withTransaction(async (tx) => {
      const ins = await tx.query(
        `INSERT INTO play_purchases (user_id, product_id, purchase_token, state, expires_at)
         VALUES ($1, $2, $3, 'active', $4)
         ON CONFLICT (purchase_token) DO NOTHING
         RETURNING user_id`,
        [user.id, productId, purchaseToken, premiumUntil]
      );
      if ((ins.rowCount ?? 0) === 0) {
        inserted = false;
        return;
      }
      if (productId === 'premium_annual' && premiumUntil) {
        // GREATEST: una compra nueva no encoge un premium ya vigente (patrón
        // del webhook de Stripe).
        await tx.query(
          `UPDATE users SET is_premium = TRUE,
                             premium_until = GREATEST(COALESCE(premium_until, NOW()), $2::timestamptz),
                             updated_at = NOW()
             WHERE id = $1`,
          [user.id, premiumUntil]
        );
      } else {
        await tx.query(
          `UPDATE users SET is_premium = TRUE, premium_lifetime = TRUE, updated_at = NOW()
             WHERE id = $1`,
          [user.id]
        );
      }
    });

    if (!inserted) {
      // Carrera: otro verify insertó el token entre la lectura y la TX.
      const owner = await db.query<{ user_id: string }>(
        'SELECT user_id FROM play_purchases WHERE purchase_token = $1',
        [purchaseToken]
      );
      if (owner.rows[0]?.user_id !== user.id) {
        return c.json({ error: 'token_owned_by_other_user' }, 409);
      }
      return c.json(await entitlementOf(user.id));
    }

    logger.info({ userId: user.id, productId }, '[play] Premium concedido vía Google Play');

    // Analítica FUERA de la transacción (patrón Stripe): no bloquea el efecto.
    try {
      const { analytics } = await import('@sports/analytics');
      analytics.capture({
        distinctId: user.id,
        event: 'premium_purchased',
        properties: { provider: 'play', product_id: productId },
      });
      await analytics.flush();
    } catch { /* sin POSTHOG_API_KEY no bloqueamos la respuesta */ }

    return c.json(await entitlementOf(user.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('play_not_configured')) {
      return c.json({ error: 'play_not_configured' }, 503);
    }
    if (msg.startsWith('play_token_error') || msg.startsWith('play_api_error')) {
      return c.json({ error: 'play_unavailable' }, 502);
    }
    captureRouteError(err, '[play] verify error');
    logger.error({ err }, '[play] verify error');
    return c.json({ error: 'server_error' }, 500);
  }
});

playRouter.get('/status', rateLimit(60, 60_000), async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  return c.json(await entitlementOf(user.id));
});
```

NOTAS de implementación:
- `requireUser`: si `userFromBearer` devuelve un tipo con `id: string`, usarlo tal cual; ajustar el helper al tipo real (`Awaited<ReturnType<typeof userFromBearer>>`).
- La firma del helper `requireUser` es orientativa: si el tipado de Hono complica, inlinear `await userFromBearer(...)` en cada handler (como hace `auth.ts`).

- [ ] **Step 4: Montar el router y registrar env**

En `apps/api/src/index.ts`, junto al resto de routers de pago (import + `.route`):

```ts
import { playRouter } from './routes/payments-play.js';
// ... dentro del encadenado de .route(...) existente:
//   .route('/payments/play', playRouter)
```

En `apps/api/src/lib/env.ts`, añadir a `RECOMMENDED_PROD`:

```ts
  { key: 'GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL', feature: 'verificación de compras Play (verify)' },
  { key: 'GOOGLE_PLAY_PRIVATE_KEY',           feature: 'verificación de compras Play (verify)' },
  { key: 'GOOGLE_PLAY_PACKAGE_NAME',          feature: 'verificación de compras Play (verify)' },
```

- [ ] **Step 5: Tests en verde + typecheck**

```powershell
npm run test --workspace=@sports/api
npm run typecheck --workspace=@sports/api
```

Expected: PASS ambos.

- [ ] **Step 6: Commit**

```powershell
git add apps/api/src/routes/payments-play.ts apps/api/src/routes/payments-play.test.ts apps/api/src/index.ts apps/api/src/lib/env.ts
git commit -m "feat(api): POST /payments/play/verify + status con idempotencia por token"
```

---

### Task 5: Job diario `play-reconcile` (ETL)

**Files:**
- Create: `apps/etl/src/play-reconcile.ts`
- Modify: `deploy/etl-scheduler.sh` (bloque diario)
- Create: `apps/etl/src/play-reconcile.test.ts`

- [ ] **Step 1: Implementar el job (entry standalone, patrón partition-guard)**

Crear `apps/etl/src/play-reconcile.ts`. La lógica de negocio (pura) y el `main` separados:

```ts
/**
 * play-reconcile (cron diario, spec monetización §6): sincroniza el premium de
 * Play con la realidad de Google.
 *   1. Suscripciones anuales activas → revalidar con subscriptionsv2:
 *      renovada → premium_until = nueva expiración; expirada → state='expired'
 *      (el guard la excluye al quedar en el pasado).
 *   2. voidedpurchases → reembolsos: state='revoked'; si era lifetime, quitar
 *      users.premium_lifetime.
 * Cada acción queda en log EXPLÍCITO. Nunca concede premium (solo mantiene).
 * Sin lock del pipeline: no compite con scraping (patrón partition-guard).
 */
import { db } from '@sports/db';
import { logger } from '@sports/logger';
import {
  getSubscription,
  listVoidedPurchases,
  getPlayCredentials,
} from '../../api/src/lib/play.js';

export async function reconcileSubscription(
  purchaseToken: string,
  userId: string,
  now: Date = new Date()
): Promise<'extended' | 'expired' | 'unchanged' | 'error'> {
  try {
    const sub = await getSubscription(purchaseToken, 'premium_annual');
    if (sub.active && sub.expiresAt) {
      const res = await db.query<{ premium_until: Date | null }>(
        `UPDATE users SET premium_until = GREATEST(COALESCE(premium_until, NOW()), $2::timestamptz),
                            updated_at = NOW()
           WHERE id = $1 RETURNING premium_until`,
        [userId, sub.expiresAt.toISOString()]
      );
      await db.query(
        `UPDATE play_purchases SET state = 'active', expires_at = $2, updated_at = NOW()
          WHERE purchase_token = $1`,
        [purchaseToken, sub.expiresAt.toISOString()]
      );
      const current = res.rows[0]?.premium_until ? new Date(res.rows[0].premium_until).getTime() : 0;
      return sub.expiresAt.getTime() > current - 1_000 ? 'extended' : 'unchanged';
    }
    await db.query(
      `UPDATE play_purchases SET state = 'expired', updated_at = NOW() WHERE purchase_token = $1`,
      [purchaseToken]
    );
    logger.warn({ purchaseToken, userId }, '[play-reconcile] suscripción expirada/revocada en Play');
    return 'expired';
  } catch (err) {
    logger.error({ err, purchaseToken, userId }, '[play-reconcile] error revalidando suscripción');
    return 'error';
  }
}

export async function reconcileVoided(
  now: Date = new Date()
): Promise<number> {
  if (!getPlayCredentials().email) {
    logger.warn('[play-reconcile] Play sin configurar: reembolsos no revisados');
    return 0;
  }
  let revoked = 0;
  try {
    for (const v of await listVoidedPurchases()) {
      if (!v.purchaseToken) continue;
      const res = await db.query<{ user_id: string; product_id: string }>(
        `UPDATE play_purchases SET state = 'revoked', updated_at = NOW()
          WHERE purchase_token = $1 AND state <> 'revoked'
          RETURNING user_id, product_id`,
        [v.purchaseToken]
      );
      const row = res.rows[0];
      if (!row) continue;
      if (row.product_id === 'premium_lifetime') {
        await db.query(
          `UPDATE users SET premium_lifetime = FALSE, updated_at = NOW() WHERE id = $1`,
          [row.user_id]
        );
      }
      logger.warn({ purchaseToken: v.purchaseToken, userId: row.user_id, product: row.product_id },
        '[play-reconcile] compra REEMBOLSADA: premium revocado');
      revoked += 1;
    }
  } catch (err) {
    logger.error({ err }, '[play-reconcile] error listando voidedpurchases');
  }
  return revoked;
}

export async function main(): Promise<void> {
  const purchases = await db.query<{ purchase_token: string; user_id: string }>(
    `SELECT purchase_token, user_id FROM play_purchases
      WHERE state = 'active' AND product_id = 'premium_annual'`
  );
  logger.info({ total: purchases.rows.length }, '[play-reconcile] revalidando suscripciones');
  let extended = 0; let expired = 0; let errors = 0;
  for (const row of purchases.rows) {
    const outcome = await reconcileSubscription(row.purchase_token, row.user_id);
    if (outcome === 'extended' || outcome === 'unchanged') extended += 1;
    else if (outcome === 'expired') expired += 1;
    else errors += 1;
  }
  const voided = await reconcileVoided();
  logger.info({ extended, expired, voided, errors }, '[play-reconcile] fin');
  if (errors > 0) process.exitCode = 1; // explícito para el scheduler
}

// Entry standalone (node dist/apps/etl/src/play-reconcile.js)
if (process.argv[1] && process.argv[1].endsWith('play-reconcile.js')) {
  void main();
}
```

NOTA: revisa cómo lo hacen `partition-guard.ts` / `scrape-health-watch.ts` para el entry standalone EXACTO del repo (patrón `import.meta`/argv) y ajusta la última línea — el resto no cambia.

- [ ] **Step 2: Test unitario de la lógica pura**

Crear `apps/etl/src/play-reconcile.test.ts` con `vi.mock('@sports/db')` y `vi.mock('../../api/src/lib/play.js')`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = { query: vi.fn() };
vi.mock('@sports/db', () => ({ db: dbMock }));

const playMock = { getSubscription: vi.fn(), listVoidedPurchases: vi.fn(), getPlayCredentials: vi.fn(() => ({ email: 'sa@x', privateKey: 'k' })) };
vi.mock('../../api/src/lib/play.js', () => playMock);

import { reconcileSubscription, reconcileVoided } from './play-reconcile.js';

describe('reconcileSubscription', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renovada: extiende premium_until y deja state=active', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ premium_until: new Date('2030-06-01T00:00:00Z') }] })
      .mockResolvedValueOnce({ rows: [] });
    playMock.getSubscription.mockResolvedValue({
      kind: 'subscription', valid: true, active: true, expiresAt: new Date('2030-06-01T00:00:00Z'),
    });
    const outcome = await reconcileSubscription('tok', 'u1');
    expect(outcome).toBe('extended');
    expect(dbMock.query).toHaveBeenCalledTimes(2);
  });

  it('expirada en Play: marca state=expired y no toca users', async () => {
    dbMock.query.mockResolvedValue({ rows: [] });
    playMock.getSubscription.mockResolvedValue({
      kind: 'subscription', valid: false, active: false, expiresAt: null,
    });
    const outcome = await reconcileSubscription('tok', 'u1');
    expect(outcome).toBe('expired');
    expect(dbMock.query).toHaveBeenCalledTimes(1);
  });

  it('Google caído: error explícito, sin tocar BD', async () => {
    playMock.getSubscription.mockRejectedValue(new Error('play_api_error: 503'));
    const outcome = await reconcileSubscription('tok', 'u1');
    expect(outcome).toBe('error');
    expect(dbMock.query).not.toHaveBeenCalled();
  });
});

describe('reconcileVoided', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reembolso de lifetime: revoca compra y quita premium_lifetime', async () => {
    playMock.listVoidedPurchases.mockResolvedValue([{ purchaseToken: 'tok-l' }]);
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1', product_id: 'premium_lifetime' }] })
      .mockResolvedValueOnce({ rows: [] });
    const n = await reconcileVoided();
    expect(n).toBe(1);
    expect(dbMock.query).toHaveBeenCalledTimes(2);
  });

  it('sin credenciales: avisa y no llama a Google', async () => {
    playMock.getPlayCredentials.mockReturnValue({ email: '', privateKey: '' });
    expect(await reconcileVoided()).toBe(0);
    expect(playMock.listVoidedPurchases).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Registrar en el scheduler (bloque diario, DESPUÉS de integrity-check)**

En `deploy/etl-scheduler.sh`, dentro del bloque diario (`HOUR_UTC = 06`), justo tras la entrada de `integrity-check`, añadir:

```sh
    # Reconciliación de compras Play (monetización): extiende premium_until de
    # suscripciones renovadas, marca expiradas y revoca reembolsos. Sin lock:
    # no compite con scraping (patrón partition-guard). Falla explícito.
    echo "[scheduler] play-reconcile $(date -u +%T)"
    node dist/apps/etl/src/play-reconcile.js \
      || echo "[scheduler] play-reconcile fallo (seguimos)"
```

- [ ] **Step 4: Tests + typecheck + lint del workspace**

```powershell
npm run test --workspace=@sports/etl
npm run typecheck --workspace=@sports/etl
npm run lint --workspace=@sports/etl
```

Expected: PASS los tres. Además, el check de CI "los entrypoints de producción existen" exige que el build incluya el entry: compilar y comprobar.

```powershell
npm run build:server
```

Expected: `dist/apps/etl/src/play-reconcile.js` existe. Si `build-server.mjs` lista entrypoints explícitos, añadir `apps/etl/src/play-reconcile.ts` siguiendo el patrón de `partition-guard.ts`.

- [ ] **Step 5: Commit**

```powershell
git add apps/etl/src/play-reconcile.ts apps/etl/src/play-reconcile.test.ts deploy/etl-scheduler.sh scripts/build-server.mjs
git commit -m "feat(etl): job diario play-reconcile (renovaciones y reembolsos de Play)"
```

---

### Task 6: Integración real + estado

**Files:**
- Create: `tests/integration/play-verify.test.ts`
- Modify: `docs/superpowers/specs/2026-10-06-monetizacion-ads-premium-design.md` (estado)

- [ ] **Step 1: Test de integración contra Postgres real**

Crear `tests/integration/play-verify.test.ts` — mismo enfoque que `stripe.integration.test.ts`: router REAL contra Postgres real, mockeando SOLO `lib/play.js` (la API de Google) y `session-lookup.js` (la sesión Bearer). `limpiar()` trunca entre tests y `closeDb()` cierra al final:

```ts
/**
 * Pagos con Google Play (payments-play.ts) — idempotencia, cross-account y
 * lifetime contra Postgres real. Router real; mockeados solo lib/play.js
 * (API de Google) y session-lookup.js (sesión Bearer).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { db, closeDb } from '@sports/db';
import { limpiar } from './support/db.js';

const { getSubscription, getProduct, userFromBearer } = vi.hoisted(() => ({
  getSubscription: vi.fn(),
  getProduct: vi.fn(),
  userFromBearer: vi.fn(),
}));

vi.mock('../../apps/api/src/lib/play.js', () => ({
  getSubscription,
  getProduct,
  listVoidedPurchases: vi.fn(),
  getPlayCredentials: vi.fn(() => ({ email: '', privateKey: '' })),
  buildPlayJwt: vi.fn(),
  getAccessToken: vi.fn(),
}));

vi.mock('../../apps/api/src/lib/session-lookup.js', () => ({ userFromBearer }));

const { playRouter } = await import('../../apps/api/src/routes/payments-play.js');

const app = new Hono();
app.route('/payments/play', playRouter);

const verify = (body: Record<string, unknown>, userId: string | null) =>
  app.request('/payments/play/verify', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: userId ? { Authorization: 'Bearer sesion-de-prueba' } : {},
  });

async function crearUsuario(deviceId: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO users (device_id) VALUES ($1) RETURNING id`,
    [deviceId]
  );
  return r.rows[0]!.id;
}

beforeEach(async () => {
  await limpiar();
  vi.clearAllMocks();
});
afterAll(async () => { await closeDb(); });

describe('POST /payments/play/verify (integración real)', () => {
  it('T-1: 401 sin sesión', async () => {
    userFromBearer.mockResolvedValue(null);
    const res = await verify({ purchaseToken: 'token123456', productId: 'premium_lifetime' }, null);
    expect(res.status).toBe(401);
  });

  it('T-2: lifetime concede premium_lifetime permanente en users', async () => {
    const userId = await crearUsuario('dev-play-1');
    userFromBearer.mockResolvedValue({ id: userId });
    getProduct.mockResolvedValue({ kind: 'product', valid: true, purchased: true });

    const res = await verify({ purchaseToken: 'token-lifetime-1', productId: 'premium_lifetime' }, userId);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ premium: true, premiumLifetime: true });

    const u = await db.query<{ premium_lifetime: boolean }>(
      `SELECT premium_lifetime FROM users WHERE id = $1`, [userId]
    );
    expect(u.rows[0]!.premium_lifetime).toBe(true);
    const p = await db.query<{ state: string }>(
      `SELECT state FROM play_purchases WHERE purchase_token = $1`, ['token-lifetime-1']
    );
    expect(p.rows[0]!.state).toBe('active');
  });

  it('T-3: idempotencia real — reenviar el mismo token no re-otorga ni duplica', async () => {
    const userId = await crearUsuario('dev-play-2');
    userFromBearer.mockResolvedValue({ id: userId });
    getProduct.mockResolvedValue({ kind: 'product', valid: true, purchased: true });

    await verify({ purchaseToken: 'token-dup', productId: 'premium_lifetime' }, userId);
    const segunda = await verify({ purchaseToken: 'token-dup', productId: 'premium_lifetime' }, userId);
    expect(segunda.status).toBe(200);
    expect(await segunda.json()).toMatchObject({ premium: true, premiumLifetime: true });

    const p = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM play_purchases WHERE purchase_token = $1`, ['token-dup']
    );
    expect(p.rows[0]!.n).toBe(1);
    expect(getProduct).toHaveBeenCalledTimes(1); // la segunda NO vuelve a Google
  });

  it('T-4: token registrado por OTRO usuario → 409 y sin cambios', async () => {
    const owner = await crearUsuario('dev-play-owner');
    const other = await crearUsuario('dev-play-other');
    getProduct.mockResolvedValue({ kind: 'product', valid: true, purchased: true });

    userFromBearer.mockResolvedValue({ id: owner });
    await verify({ purchaseToken: 'token-shared', productId: 'premium_lifetime' }, owner);

    userFromBearer.mockResolvedValue({ id: other });
    const res = await verify({ purchaseToken: 'token-shared', productId: 'premium_lifetime' }, other);
    expect(res.status).toBe(409);
    const o = await db.query<{ premium_lifetime: boolean }>(
      `SELECT premium_lifetime FROM users WHERE id = $1`, [other]
    );
    expect(o.rows[0]!.premium_lifetime).toBe(false);
  });

  it('T-5: anual activa concede premium_until = expiración de Play', async () => {
    const userId = await crearUsuario('dev-play-3');
    userFromBearer.mockResolvedValue({ id: userId });
    getSubscription.mockResolvedValue({
      kind: 'subscription', valid: true, active: true, expiresAt: new Date('2030-06-01T00:00:00Z'),
    });
    const res = await verify({ purchaseToken: 'token-annual-1', productId: 'premium_annual' }, userId);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ premium: true, premiumUntil: '2030-06-01T00:00:00.000Z' });
  });

  it('T-6: Google caído → 502 explícito y NADA concedido', async () => {
    const userId = await crearUsuario('dev-play-4');
    userFromBearer.mockResolvedValue({ id: userId });
    getSubscription.mockRejectedValue(new Error('play_api_error: google respondió 503'));
    const res = await verify({ purchaseToken: 'token-down', productId: 'premium_annual' }, userId);
    expect(res.status).toBe(502);
    const u = await db.query<{ is_premium: boolean }>(
      `SELECT is_premium FROM users WHERE id = $1`, [userId]
    );
    expect(u.rows[0]!.is_premium).toBe(false);
    const p = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM play_purchases`, []
    );
    expect(p.rows[0]!.n).toBe(0);
  });
});
```

- [ ] **Step 2: Suite de integración en verde**

```powershell
npm run test:integration:docker
```

Expected: PASS (incluye la reaplicación de migraciones — la 070 es idempotente).

- [ ] **Step 3: Gates completos del repo**

```powershell
npm run typecheck
npm run lint
npm run test
```

Expected: los tres PASS.

- [ ] **Step 4: Actualizar el estado del spec de monetización**

En `docs/superpowers/specs/2026-10-06-monetizacion-ads-premium-design.md`, línea de estado, sustituir:

```markdown
Estado: Diseño aprobado en brainstorming; pendiente plan de implementación.
```

por:

```markdown
Estado: En implementación por planes: A-servidor (2026-10-06-monetizacion-play-servidor.md) hecho; pendientes B-compra-en-app y C-admob. La app móvil base ya está implementada (plan 2026-10-05-app-movil.md).
```

- [ ] **Step 5: Commit**

```powershell
git add tests/integration/play-verify.test.ts docs/superpowers/specs/2026-10-06-monetizacion-ads-premium-design.md
git commit -m "test(integration): idempotencia y cross-account de /payments/play/verify"
```

---

## Riesgos conocidos

1. **Credenciales Google (humano, fuera del repo):** service account con acceso a Play Console → API access, y `GOOGLE_PLAY_*` en `.env.prod` con la clave privada escapada (`\n`). Sin ellas, verify responde 503 explícito y el reconciler avisa — nada se rompe.
2. **Shapes de androidpublisher v3:** verificables contra la referencia oficial; la normalización está aislada y testada.
3. **`users.id` debe ser UUID** para `REFERENCES users(id)`: si el tipo real difiere, la migración se ajusta a ese tipo (comprobar en Task 1 contra el esquema real antes de aplicar).
4. **Precisión del reconciler (24 h):** el caso límite renovación-día-expiración está aceptado en el spec §12 con mitigación de buffer; este plan lo deja documentado para el plan B (la app puede re-verificar al arrancar).
