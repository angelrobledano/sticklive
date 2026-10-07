# Monetización (2/3) — App: premium por sesión + AdMob v1: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la app lea el premium de su sesión (`GET /payments/status`), ofrezca la compra SOLO en la web (abre sticklive.eu en el navegador del sistema) y muestre banners AdMob (con consentimiento UMP) solo a quien no es premium.

**Architecture:** El entitlement ya vive en `users` (Plan A merged): la app lo consulta con su sesión Bearer vía TanStack Query y un guard PURO decide si hay ads (`premium` gana siempre; sin consentimiento UMP no hay ads; sin unit id configurado no hay ads — fail-closed). AdMob se inicializa SOLO si el guard lo permite. La compra abre sticklive.eu en el navegador del sistema; al volver a la app, el refresco on-focus recoge el estado nuevo. Sin SDK de pagos en la app (cero IAP).

**Tech Stack:** Expo SDK 57 / RN 0.86.3 (existente), `react-native-google-mobile-ads@^17.2.0` (peers: expo ≥47, RN ≥0.86 — verificado en npm), TanStack Query (existente), UMP SDK integrado en la librería (AdsConsent), vitest para lógica pura.

**Alcance v1 (spec de monetización §7, v1 conservadora):** UMP + banners adaptativos en las 4 listas + banner en ficha SOLO de partido finalizado/por jugar + pantalla premium con compra web. **FUERA (iteración posterior, cuando los banners den datos):** native in-feed, app open, interstitial, rewarded y `GET /ads/config` — sus bloques AdMob ya están creados y apuntados en `docs/monetizacion.md §6`.

**Regla del repo (apps/mobile/AGENTS.md):** antes de tocar la API del SDK de ads, LEER la documentación instalada del paquete (`node_modules/react-native-google-mobile-ads/README.md` y su carpeta de docs) — manda sobre cualquier recuerdo. Los snippets de este plan son baseline: si la doc instalada difiere, manda la doc y anota la desviación en el commit.

**Importante — ads y builds:** AdMob NO funciona en Expo Go. La app ya usa development builds (`expo-dev-client` está en dependencias y el push de M4 lo exige), así que no hay cambio de flujo. En `__DEV__` SIEMPRE TestIds del SDK; los IDs reales solo viajan en builds de `production` (variables `EXPO_PUBLIC_*`, mismas vacías en dev).

**IDs AdMob (públicos, registro completo en `docs/monetizacion.md §6`):**
- App: `ca-app-pub-2994866776026136~4595623578`
- Banner listas: `ca-app-pub-2994866776026136/4268320510`
- Banner ficha finalizada: `ca-app-pub-2994866776026136/2815638044`

---

## Estructura de ficheros

```
apps/mobile/
├── src/lib/api/types.ts                  # + PremiumStatus (DTO de /payments/status)
├── src/hooks/queries.ts                  # + qk.premium + fetchPremiumStatus (patrón queries.ts)
├── src/hooks/usePremiumStatus.ts         # hook de sesión + refresco on-focus
├── src/hooks/premium.test.ts             # lógica pura: gating + fetch (patrón queries.test.ts)
├── src/lib/ads/gating.ts                 # puro: shouldShowAds({premium, consent, unitId})
├── src/lib/ads/gating.test.ts
├── src/lib/ads/consent.ts                # wrapper UMP (sigue doc instalada)
├── src/components/ads/AdBanner.tsx       # banner adaptativo con gates
├── app/settings/premium.tsx              # pantalla premium (compra → navegador)
├── app/(tabs)/settings.tsx               # + entrada "Premium"
├── app/(tabs)/index.tsx                  # + AdBanner (pie)
├── app/(tabs)/standings.tsx              # + AdBanner (pie)
├── app/(tabs)/search.tsx                 # + AdBanner (pie)
├── app/(tabs)/favorites.tsx              # + AdBanner (pie)
├── app/match/[id].tsx                    # + AdBanner SOLO si partido NO en vivo
├── src/i18n/locales.ts                   # + claves premium.* (5 idiomas)
├── src/lib/analytics.ts                  # + premium_viewed / premium_web_checkout_started
├── src/lib/api/client.ts                 # + EXPO_PUBLIC_WEB_URL (base para el navegador)
└── app.config.ts                         # + plugin react-native-google-mobile-ads
```

También: `docs/monetizacion.md §6` (estado → implementado v1) al cierre.

---

### Task 1: Estado premium por sesión (lógica y datos)

**Files:**
- Modify: `apps/mobile/src/lib/api/types.ts`, `apps/mobile/src/hooks/queries.ts`
- Create: `apps/mobile/src/hooks/usePremiumStatus.ts`, `apps/mobile/src/hooks/premium.test.ts`

- [ ] **Step 1: Leer los patrones existentes**

Lee `apps/mobile/src/hooks/queries.ts` (estructura de `qk`, gating puro, `fetchX` con `apiFetch`, cómo testea `queries.test.ts` con el fetch global stubeado) y `apps/mobile/src/lib/api/types.ts` (dónde viven los DTO). El plan asume esos patrones — si difieren, manda el fichero.

- [ ] **Step 2: Test primero (debe fallar)**

Crear `apps/mobile/src/hooks/premium.test.ts` siguiendo el patrón de `queries.test.ts` (fetch global stubeado, `vi.stubGlobal`):

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchPremiumStatus, shouldShowAds } from './queries.js';

// El guard de ads es la regla de dinero: premium SIEMPRE gana; sin
// consentimiento UMP no hay ads; sin unit id no hay ads (fail-closed).
describe('shouldShowAds', () => {
  it('premium gana siempre, haya o no consentimiento', () => {
    expect(shouldShowAds({ premium: true, consentGranted: true, unitId: 'u' })).toBe(false);
    expect(shouldShowAds({ premium: true, consentGranted: false, unitId: 'u' })).toBe(false);
  });

  it('sin premium: ads solo con consentimiento UMP Y unit id configurado', () => {
    expect(shouldShowAds({ premium: false, consentGranted: true, unitId: 'u' })).toBe(true);
    expect(shouldShowAds({ premium: false, consentGranted: false, unitId: 'u' })).toBe(false);
    expect(shouldShowAds({ premium: false, consentGranted: true, unitId: '' })).toBe(false);
  });
});

describe('fetchPremiumStatus', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('GET /payments/status con Bearer y mapea el DTO', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ premium: true, premiumUntil: null, premiumLifetime: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const status = await fetchPremiumStatus('tok');

    expect(status).toEqual({ premium: true, premiumUntil: null, premiumLifetime: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/payments/status');
    expect((init as { headers: Record<string, string> }).headers['Authorization']).toBe(
      'Bearer tok'
    );
  });
});
```

- [ ] **Step 3: Ejecutar y verificar que falla**

```powershell
npm run test --workspace=@sports/mobile
```

Expected: FAIL — `queries.js` no exporta `fetchPremiumStatus` ni `shouldShowAds`.

- [ ] **Step 4: Implementar (mínimo para pasar)**

En `apps/mobile/src/lib/api/types.ts`:

```ts
/** GET /payments/status (apps/api/src/routes/payments-status.ts). */
export interface PremiumStatus {
  premium: boolean;
  premiumUntil: string | null;
  premiumLifetime: boolean;
}
```

En `apps/mobile/src/hooks/queries.ts` (patrón existente):

```ts
// En qk:
  premium: ['premium'] as const,

// Gating puro (exportado para el test y para AdBanner):
export function shouldShowAds(gate: {
  premium: boolean;
  consentGranted: boolean;
  unitId: string | null | undefined;
}): boolean {
  if (gate.premium) return false;
  if (!gate.consentGranted) return false;
  return Boolean(gate.unitId);
}

// QueryFn:
export async function fetchPremiumStatus(token: string): Promise<PremiumStatus> {
  return apiFetch<PremiumStatus>('/payments/status', { token });
}
```

(Importar `PremiumStatus` de `@/src/lib/api/types`. `apiFetch` ya añade el Bearer con `opts.token` — ver client.ts:28-31.)

- [ ] **Step 5: Ejecutar y verificar que pasa**

```powershell
npm run test --workspace=@sports/mobile
```

Expected: PASS (76 existentes + ~5 nuevos).

- [ ] **Step 6: Commit**

```powershell
git add apps/mobile/src/lib/api/types.ts apps/mobile/src/hooks/queries.ts apps/mobile/src/hooks/premium.test.ts
git commit -m "feat(mobile): estado premium por sesion (GET /payments/status) + guard de ads"
```

---

### Task 2: Pantalla premium + entrada en Ajustes (compra SOLO web)

**Files:**
- Create: `apps/mobile/app/settings/premium.tsx`
- Modify: `apps/mobile/app/(tabs)/settings.tsx` (entrada), `apps/mobile/src/i18n/locales.ts` (+claves premium.*), `apps/mobile/src/lib/analytics.ts` (+eventos), `apps/mobile/src/lib/api/client.ts` (+`WEB_URL`)
- Create: `apps/mobile/src/hooks/usePremiumStatus.ts`

- [ ] **Step 1: Leer los patrones de rutas anidadas e i18n**

Lee `apps/mobile/app/settings/notifications.tsx` (o el fichero equivalente de la carpeta `app/settings/` — así se define una pantalla secundaria de Ajustes con cabecera) y `apps/mobile/src/i18n/LocaleContext.tsx` + `locales.ts` (cómo se añaden claves y cómo funciona `t()`).

- [ ] **Step 2: WEB_URL + hook de estado**

En `apps/mobile/src/lib/api/client.ts`, junto a `API_URL`:

```ts
/** Base de la web para abrir en el navegador del sistema (compra premium). */
export const WEB_URL = process.env['EXPO_PUBLIC_WEB_URL'] ?? 'https://sticklive.eu';
```

Y en el mismo fichero, la función pura que construye la URL de compra (testeada en `premium.test.ts`). **La compra vive en `/settings` — landing `/premium` pendiente en la web** (la web solo tiene `premium/success` y `premium/error`; el checkout es el PremiumBanner de Ajustes):

```ts
/**
 * Página de la web donde ocurre la compra premium (Stripe): hoy vive en
 * Ajustes (PremiumBanner). Una landing /premium dedicada es mejora futura
 * de la web — no construir aquí una URL que aún no existe.
 */
export function buildWebPremiumUrl(webBase: string, locale: string): string {
  return `${webBase.replace(/\/$/, '')}/${locale}/settings`;
}
```

Con test puro en `apps/mobile/src/hooks/premium.test.ts`:

```ts
describe('buildWebPremiumUrl', () => {
  it('construye {base}/{locale}/settings y tolera barra final', () => {
    expect(buildWebPremiumUrl('https://sticklive.eu', 'es')).toBe('https://sticklive.eu/es/settings');
    expect(buildWebPremiumUrl('https://sticklive.eu/', 'en')).toBe('https://sticklive.eu/en/settings');
  });
});
```

Crear `apps/mobile/src/hooks/usePremiumStatus.ts`:

```ts
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchPremiumStatus, qk } from './queries.js';
import { useSession } from '@/src/context/AuthContext';
import type { PremiumStatus } from '@/src/lib/api/types';

export interface UsePremiumStatusResult {
  /**
   * boolean | undefined: `undefined` = cargando o error CON sesión → el guard
   * shouldShowAds hace fail-closed (nunca banner ante desconocido). `false`
   * solo sin sesión (el anónimo sí ve ads). NUNCA colapsar undefined a false:
   * un premium vería un flash de banner (spec §7: premium ⇒ cero SDK).
   */
  premium: boolean | undefined;
  premiumLifetime: boolean | undefined;
  isLoading: boolean;
  refresh: () => void;
}

/**
 * Estado premium de la SESIÓN (GET /payments/status). enabled solo con
 * sesión: sin login no hay entitlement que consultar (el anónimo ve ads).
 * Refresco on-focus: al volver del navegador tras pagar en la web, el estado
 * nuevo llega sin reiniciar la app.
 */
export function usePremiumStatus(): UsePremiumStatusResult {
  const { session } = useSession();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: qk.premium,
    queryFn: () => fetchPremiumStatus(session!.token),
    enabled: Boolean(session?.token),
    staleTime: 5 * 60_000,
  });

  useFocusEffect(
    useCallback(() => {
      if (session?.token) void qc.invalidateQueries({ queryKey: qk.premium });
    }, [session?.token, qc])
  );

  return {
    premium: session?.token ? query.data?.premium : false,
    premiumLifetime: session?.token ? query.data?.premiumLifetime : false,
    isLoading: query.isPending,
    refresh: () => void qc.invalidateQueries({ queryKey: qk.premium }),
  };
}
```

Nota de contrato (review Task 1): `premium` es `boolean | undefined` — AdBanner (Task 4) pasa el valor CRUDO a `shouldShowAds`, que hace fail-closed con `undefined`.

- [ ] **Step 3: i18n + analítica**

Añade las claves `premium.*` al catálogo de `src/i18n/locales.ts` en los 5 idiomas (es primero; sigue el estilo del fichero): `premium.title`, `premium.status_active`, `premium.status_active_desc`, `premium.upgrade_title`, `premium.upgrade_desc`, `premium.buy_on_web`, `premium.login_required`, `premium.loading`. Copia el significado — no traduzcas a ciegas: mira 2-3 claves vecinas para el tono.

En `src/lib/analytics.ts`, extiende `AnalyticsEventProps` (mismo patrón que el resto):

```ts
  premium_viewed: Record<string, never>;
  premium_web_checkout_started: Record<string, never>;
```

- [ ] **Step 4: Pantalla + entrada**

Crea `apps/mobile/app/settings/premium.tsx` siguiendo el patrón de las pantallas de `app/settings/` (cabecera con `Stack.Screen options={{ title: t('premium.title') }}`, contenido con los tokens de tema y `min-h-[44px]` en tocables — ver settings.tsx). Comportamiento:

- `usePremiumStatus()` + `useSession()`.
- Sin sesión → texto `premium.login_required` (la compra exige cuenta: así el pago en web queda ligado a la misma fila de usuario).
- Premium → estado activo (`premium.status_active` + desc; badge dorado `bg-premium-gold` si existe en el tema, si no el granate).
- No premium → dos filas de producto (Anual / Para siempre, solo informativas con precio visible en la web) + botón principal `premium.buy_on_web` que: captura `premium_web_checkout_started`, y `void Linking.openURL(buildWebPremiumUrl(WEB_URL, locale))` con `locale` de `useLocale()` (la compra vive en `/settings` — landing `/premium` pendiente en la web, ver Step 2).
- Al volver del navegador el `useFocusEffect` del hook ya refresca.
- Al montar la pantalla: captura `premium_viewed`.

En `app/(tabs)/settings.tsx` añade la fila de entrada (patrón de las filas existentes — icono Ionicons `star-outline`, navega a `/settings/premium`).

- [ ] **Step 5: Gates + commit**

```powershell
npm run test --workspace=@sports/mobile
npm run typecheck --workspace=@sports/mobile
npm run lint --workspace=@sports/mobile
```

Expected: PASS. Smoke manual (Expo Go vale aquí: sin ads todavía): la pantalla abre el navegador y al volver refresca.

```powershell
git add apps/mobile
git commit -m "feat(mobile): pantalla premium con compra en web y estado por sesion"
```

---

### Task 3: AdMob — SDK, config y consentimiento UMP

**Files:**
- Modify: `apps/mobile/package.json`, `apps/mobile/app.config.ts`
- Create: `apps/mobile/src/lib/ads/gating.ts` (si no se puso en Task 1), `apps/mobile/src/lib/ads/consent.ts`

- [ ] **Step 1: Instalar el SDK y LEER su doc instalada (obligatorio)**

```powershell
npx expo install react-native-google-mobile-ads
Get-Content apps/mobile/node_modules/react-native-google-mobile-ads/README.md
```

Lee el README completo y su guía de configuración de Expo (el paquete trae config plugin propio). Verifica: cómo se declara el App ID en el config plugin, si hace falta algo más para Android (CNG — `ios/`/`android/` NO se crean a mano, ya lo dice apps/mobile/AGENTS.md) y el API exacto de UMP (`AdsConsent`). **Lo que diga la doc instalada manda sobre este plan** — anota desviaciones en el commit.

- [ ] **Step 2: app.config.ts — plugin con el App ID (público)**

Añade al array `plugins` (el App ID es público por diseño — viaja en el manifest):

```ts
      // AdMob (docs/monetizacion.md §6). El plugin inyecta el App ID en el
      // AndroidManifest; requiere recompilar la app nativa (CNG/dev build).
      [
        'react-native-google-mobile-ads',
        {
          // Delay de init del SDK de medición: la app decide cuándo (solo si
          // NO es premium) — el gating vive en AdBanner/consent.ts.
          androidAppId: 'ca-app-pub-2994866776026136~4595623578',
        },
      ],
```

(Sin iOS: el diseño es Android primero; `iosAppId` llega con el hito iOS — consulta la doc instalada para ver si el plugin exige ambos y procede según diga.)

- [ ] **Step 3: Consentimiento UMP (wrapper siguiendo la doc instalada)**

Crear `apps/mobile/src/lib/ads/consent.ts` — la decisión de si se puede pedir ads es PURA y testeable; la llamada al UMP es fina:

```ts
/**
 * Consentimiento UMP (Google) — equivalente del CMP web (docs/monetizacion.md
 * §4). Sin consentimiento NO se sirven ads: la superficie se colapsa.
 * El wrapper sigue EXACTAMENTE la doc instalada del SDK (AdsConsent.*).
 */
export interface AdsConsentState {
  canRequestAds: boolean;
}

export function canRequestAdsAfterConsent(info: {
  canRequestAds: boolean;
}): AdsConsentState {
  return { canRequestAds: info.canRequestAds === true };
}
```

y el hook/comando async (patrón de la doc instalada): `AdsConsent.requestConsentInfoUpdate(...)` → `AdsConsent.loadAndShowConsentFormIfRequired()` → `AdsConsent.getConsentInfo()` → estado. Guarda `canRequestAds` en el hook de Task 4.

- [ ] **Step 4: Gates + commit**

```powershell
npm run test --workspace=@sports/mobile
npm run typecheck --workspace=@sports/mobile
npm run lint --workspace=@sports/mobile
```

Expected: PASS (consent.ts puro testeable si añades el test de `canRequestAdsAfterConsent`).

```powershell
git add apps/mobile
git commit -m "feat(mobile): SDK AdMob + config plugin + consentimiento UMP"
```

---

### Task 4: AdBanner + integración en pantallas (solo no-premium, solo con consentimiento)

**Files:**
- Create: `apps/mobile/src/components/ads/AdBanner.tsx`
- Modify: `apps/mobile/app/(tabs)/index.tsx`, `standings.tsx`, `search.tsx`, `favorites.tsx`, `apps/mobile/app/match/[id].tsx`

Sin tests de render (vitest no monta componentes RN; el gating YA está testeado en Task 1). Verificación: typecheck + smoke manual en development build.

- [ ] **Step 1: AdBanner**

Componente que combina los gates (patrón: el banner solo existe si TODO permite):

```tsx
// Skeleton — completa con la doc instalada del SDK (BannerAd, BannerAdSize).
// Reglas NO negociables:
//  1. premium → devuelve null ANTES de inicializar nada (cero SDK, cero
//     petición: paridad con el `null` del componente web).
//  2. sin consentimiento UMP → null.
//  3. unit id: __DEV__ SIEMPRE TestIds.BANNER; en build real el id viene de
//     EXPO_PUBLIC_ADMOB_BANNER_LIST; si viene vacío → null (fail-closed).
//  4. Reserva la altura del banner ANTES de cargar (evitar CLS — paridad web).
```

- `usePremiumStatus()` + estado de consentimiento (Task 3).
- `onAdFailedToLoad` → log explícito (`logger.warn` o `console.warn` con el code del error — nunca silencio) y el contenedor colapsa.

- [ ] **Step 2: Integración en las 4 listas + ficha**

- `app/(tabs)/index.tsx`, `standings.tsx`, `search.tsx`, `favorites.tsx`: `<AdBanner unitId={...BANNER_LIST} />` al pie del contenido (fuera de la zona de datos, bajo el listado).
- `app/match/[id].tsx`: el banner SOLO cuando el partido NO está en vivo (el DTO de partido ya trae el estado — el implementador lo lee del hook de detalle existente). En vivo, nada: la ruta del gol está blindeada (estrategia aprobada).
- Etiqueta "PUBLICIDAD" encima del banner (paridad con la web — IAB/CNMC).

- [ ] **Step 3: Gates + smoke manual**

```powershell
npm run test --workspace=@sports/mobile
npm run typecheck --workspace=@sports/mobile
npm run lint --workspace=@sports/mobile
```

Expected: PASS. Smoke REQUIERE development build (`npx expo run:android` o `eas build --profile development`) — Expo Go NO sirve para ads:
1. Sin sesión / sesión no premium → banners de TEST visibles tras el consentimiento UMP.
2. Cuenta premium (con premium comprado en web, o premium_until futuro en BD dev) → cero banner y cero petición a AdMob (verificar en el log de Metro).
3. Ficha de partido EN VIVO → sin banner; finalizada → banner.
4. Sin consentimiento UMP → sin ads.

Si algún paso no es verificable sin dispositivo/cuenta real, déjalo anotado como PENDIENTE DE UN HUMANO (no marques el paso como verificado).

- [ ] **Step 4: Commit**

```powershell
git add apps/mobile
git commit -m "feat(mobile): banners AdMob con consentimiento UMP y gating premium"
```

---

### Task 5: Cierre — analítica, docs y estado

**Files:**
- Modify: `docs/monetizacion.md` (§6 estado), `docs/superpowers/specs/2026-10-06-monetizacion-ads-premium-design.md` (línea de estado)

- [ ] **Step 1: Gates completos del repo**

```powershell
npm run typecheck
npm run lint
npm run test
```

Expected: PASS (todo el monorepo, incluida la app con los cambios).

- [ ] **Step 2: Doctor**

```powershell
npx expo-doctor --cwd apps/mobile
```

Expected: sin errores nuevos atribuibles a este plan.

- [ ] **Step 3: Smoke manual (development build)** — los 4 puntos de Task 4 Step 3. Lo no verificable queda PENDIENTE DE UN HUMANO.

- [ ] **Step 4: Docs al día**

- `docs/monetizacion.md §6`: estado → "AdMob v1 implementado en la app (UMP + banners con gating premium; compra SOLO en web)". Añade los nombres de variable `EXPO_PUBLIC_ADMOB_BANNER_LIST` / `EXPO_PUBLIC_ADMOB_BANNER_MATCH` (vacías = sin ads; los IDs reales solo en builds de production).
- Spec de monetización: la línea de estado pasa a "A-servidor hecho (purgado a web-only) y AdMob v1 de la app hecho; pendiente: formats completos (Plan D) y producto lifetime por Stripe".

- [ ] **Step 5: Commit**

```powershell
git add docs
git commit -m "docs: AdMob v1 de la app implementado (monetizacion)"
```

---

## Riesgos conocidos

1. **La doc instalada manda**: el SDK de ads cambia detalles entre versiones (init, plugin, UMP). El Step 1 de Task 3 obliga a leerla; los snippets del plan son baseline.
2. **Ads exigen development build**: sin dispositivo/emulador con dev build, el smoke manual queda PENDIENTE DE UN HUMANO (documentado, no "verificado").
3. **Consentimiento UMP en EEE**: sin el mensaje GDPR publicado en AdMob Privacidad y mensajes, `canRequestAds` será false en Europa — el usuario ya lo creó (2026-10-06). Verificar en smoke con cuenta EEA o geo-debug de UMP.
4. **El refresco post-compra depende de que el usuario vuelva a la app**: el on-focus cubre el caso normal; el deep link `sticklive://` desde la web de éxito es mejora futura (requiere app links de dominio — ya anotado en el spec de la app).
5. **Los unit ids reales solo van en builds production**: sin `EXPO_PUBLIC_ADMOB_BANNER_*` en el build, no hay ads (fail-closed) — no es un bug, es el gating.
