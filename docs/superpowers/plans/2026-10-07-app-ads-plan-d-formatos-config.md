# Monetización (3/3) — Plan D: formatos completos + config remota: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar el catálogo de formatos de la app (app open, interstitial, rewarded, native in-feed) gobernarlos por config remota (`GET /ads/config`, apagados por defecto) y cerrar el pendiente de la checklist pre-tráfico (re-consentimiento UMP en Ajustes).

**Architecture:** Un endpoint público `GET /ads/config` (Hono, sin BD, valores desde env con defaults conservadores **enabled: false**) gobierna qué formatos existen y sus caps; la app lo consulta con TanStack Query (staleTime largo, funciona sin sesión) y cada formato pregunta a su guard puro antes de existir. El presupuesto de pantalla completa (app open + interstitial) es UNO compartido: máx 2/hora, mínimo 20 min entre shows, nunca en las 2 primeras sesiones, nunca tras interacción de push (la ruta del gol). El rewarded concede 30 min sin anuncios (`adfree_until` en AsyncStorage) y ese estado se integra en el gating existente de `shouldShowAds`.

**Tech Stack:** Hono (patrón health.ts), TanStack Query, `react-native-google-mobile-ads@17.2.0` (ya instalada: RewardedAd, AppOpenAd, InterstitialAd, NativeAdView), `@react-native-async-storage/async-storage@2.2.0` (ya instalada), vitest.

**Regla de versiones (apps/mobile/AGENTS.md):** antes de tocar APIs del SDK (RewardedAd/AppOpenAd/InterstitialAd/NativeAdView) o de Expo, leer la doc instalada del paquete y la versionada de Expo v57. Los snippets son baseline; manda la doc instalada.

**Activación (la que espera a "los banners den datos"):** todo nace `enabled: false`; activar un formato = definir su env en `/opt/sticklive/.env.prod` + redesplegar el API (sin rebuild de la app — la app lee la config en runtime). Los unit ids de los formatos nuevos van como `EXPO_PUBLIC_ADMOB_APP_OPEN` / `_INTERSTITIAL` / `_REWARDED` (TestIds en `__DEV__`, reales solo en perfil production de EAS — misma regla que los banners).

**Los 4 invariantes no negociables (estrategia aprobada):**
1. **La ruta del gol blindeada**: ni app open ni interstitial si la sesión/app vino de una interacción de push (el listener de `_layout.tsx:81` marca la interacción; el app open además comprueba la `initialNotification` de arranque en frío).
2. **Presupuesto de pantalla completa compartido**: máx 2/hora y mínimo 20 min entre shows, combinando app open + interstitial.
3. **Grace period**: nada de pantalla completa en las 2 primeras sesiones del usuario.
4. **Premium siempre gana** (el gating existente de Task 1 del plan anterior no se toca; `adfree` se añade como capa más del mismo guard).

---

## Estructura de ficheros

```
apps/api/src/routes/ads-config.ts               # nuevo: GET /ads/config (público)
apps/api/src/routes/ads-config.test.ts          # nuevo
apps/api/src/index.ts                           # + montaje
apps/api/src/lib/env.ts                         # + envs de activación (RECOMMENDED_PROD no: son opcionales)
apps/mobile/src/lib/api/types.ts                # + AdsConfig DTO
apps/mobile/src/hooks/queries.ts                # + qk.adsConfig + fetchAdsConfig + useAdsConfig
apps/mobile/src/lib/ads/adfree.ts               # nuevo: puro (isAdfreeActive/extendAdfree) + storage
apps/mobile/src/lib/ads/adfree.test.ts          # nuevo
apps/mobile/src/lib/ads/fullscreen.ts           # nuevo: presupuesto compartido (puro + storage)
apps/mobile/src/lib/ads/fullscreen.test.ts      # nuevo
apps/mobile/src/lib/ads/session-context.ts      # nuevo: marca interacción de push (llamado desde _layout)
apps/mobile/src/hooks/ads/useAppOpenAd.ts       # nuevo
apps/mobile/src/hooks/ads/useInterstitialOnLeave.ts  # nuevo
apps/mobile/src/components/ads/AdBanner.tsx     # gating + adfree (extensión mínima)
apps/mobile/src/components/ads/RewardedCard.tsx # nuevo: CTA en pantalla premium
apps/mobile/src/components/ads/NativeFeedAd.tsx # nuevo: native cada N items
apps/mobile/app/settings/premium.tsx            # + RewardedCard
apps/mobile/app/settings/ads-privacy.tsx        # nuevo: re-consentimiento UMP
apps/mobile/app/(tabs)/settings.tsx             # + entrada ads-privacy
apps/mobile/app/match/[id].tsx                  # + useInterstitialOnLeave
apps/mobile/app/_layout.tsx                     # + markPushInteraction + AppOpenAd en frío
apps/mobile/src/i18n/locales (web JSONs)        # + claves ads.*
apps/mobile/src/lib/api/client.ts               # (nada: config va por API_URL)
apps/mobile/src/lib/analytics.ts                # + eventos ads.* si procede
docs/monetizacion.md §6                         # Plan D → implementado + envs de activación
docs/superpowers/specs/2026-10-06-monetizacion-ads-premium-design.md  # estado
```

---

### Task 1: Servidor — `GET /ads/config` + consumo en la app

**Files:** Create `apps/api/src/routes/ads-config.ts` + `ads-config.test.ts`; Modify `apps/api/src/index.ts`; Modify `apps/mobile/src/lib/api/types.ts`, `src/hooks/queries.ts`.

- [ ] **Step 1: Test primero (API)** — `apps/api/src/routes/ads-config.test.ts` (patrón health.test.ts): la config default tiene TODO `enabled: false`; envs activan (`ADS_APP_OPEN_ENABLED=1` etc.); valores inválidos caen al default (fail-safe, "malos datos son peores"). Helper: `buildAdsConfig(env)` PURO e importable.

```ts
import { describe, expect, it } from 'vitest';

import { buildAdsConfig } from './ads-config.js';

describe('buildAdsConfig', () => {
  it('default: todo desactivado (fail-safe — la activación es explícita)', () => {
    const cfg = buildAdsConfig({});
    expect(cfg).toEqual({
      appOpen: { enabled: false, minIntervalHours: 4 },
      interstitial: { enabled: false, minIntervalMinutes: 20, maxPerHour: 2 },
      rewarded: { enabled: false, adfreeMinutes: 30 },
      nativeFeed: { enabled: false, everyNItems: 8 },
    });
  });

  it('envs activan formatos y overridean caps', () => {
    const cfg = buildAdsConfig({
      ADS_APP_OPEN_ENABLED: '1',
      ADS_INTERSTITIAL_ENABLED: 'true',
      ADS_REWARDED_ENABLED: '1',
      ADS_REWARDED_ADFREE_MINUTES: '60',
      ADS_NATIVE_FEED_EVERY: '6',
    });
    expect(cfg.appOpen.enabled).toBe(true);
    expect(cfg.interstitial.enabled).toBe(true);
    expect(cfg.rewarded).toEqual({ enabled: true, adfreeMinutes: 60 });
    expect(cfg.nativeFeed).toEqual({ enabled: true, everyNItems: 6 });
  });

  it('valores basura caen al default (nunca inventar)', () => {
    const cfg = buildAdsConfig({
      ADS_APP_OPEN_ENABLED: 'yes',
      ADS_NATIVE_FEED_EVERY: 'cero',
      ADS_REWARDED_ADFREE_MINUTES: '-5',
    });
    expect(cfg.appOpen.enabled).toBe(false);
    expect(cfg.nativeFeed.everyNItems).toBe(8);
    expect(cfg.rewarded.adfreeMinutes).toBe(30);
  });
});
```

- [ ] **Step 2: Implementar** — `apps/api/src/routes/ads-config.ts`: `buildAdsConfig(env)` puro (parseo estricto: `'1'/'true'` → true; enteros positivos; si no, default) + `adsConfigRouter` con `GET /` que devuelve `c.json(buildAdsConfig(process.env))` con cabecera `Cache-Control: public, max-age=300`. Montar en `apps/api/src/index.ts` (`.route('/ads/config', adsConfigRouter)`). Test del router: 200 + body default (patrón health.test.ts con `app.request`).

- [ ] **Step 3: Consumo en la app** — en `src/lib/api/types.ts` el DTO `AdsConfig` (idéntico al shape del API); en `src/hooks/queries.ts`: `qk.adsConfig`, `fetchAdsConfig()` (`apiFetch<AdsConfig>('/ads/config')` — SIN token, público) y export `adsConfigEnabled(cfg, fmt)` trivial si aporta. Test: fetch con fetch stubbeado (patrón premium.test.ts).

- [ ] **Step 4: Gates + commit** — `npm run test --workspace=@sports/api`, `npm run typecheck --workspace=@sports/api`, luego móvil (`npm run test --workspace=@sports/mobile` + typecheck + lint), commit:

```powershell
git commit -m "feat(ads): GET /ads/config (publico, fail-safe) + consumo en la app"
```

---

### Task 2: Ad-free recompensado (rewarded) + gating extendido

**Files:** Create `apps/mobile/src/lib/ads/adfree.ts` + `adfree.test.ts`; Modify `queries.ts` (`shouldShowAds` + capa adfree), `AdBanner.tsx` (pasa adfree al guard), `app/settings/premium.tsx` (+RewardedCard), `src/components/ads/RewardedCard.tsx`, `src/i18n` (JSONs web, +claves ads.*).

- [ ] **Step 1: Test primero** — `adfree.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { extendAdfree, isAdfreeActive } from './adfree.js';

const NOW = new Date('2026-10-07T12:00:00Z').getTime();
const MIN = 60_000;

describe('isAdfreeActive', () => {
  it('activo si adfree_until está en el futuro', () => {
    expect(isAdfreeActive(NOW, NOW + MIN)).toBe(true);
    expect(isAdfreeActive(NOW, NOW)).toBe(false);
    expect(isAdfreeActive(NOW, null)).toBe(false);
  });
});

describe('extendAdfree (30 min desde la caducidad actual, no desde ahora)', () => {
  it('sin adfree previo: ahora + 30 min', () => {
    expect(extendAdfree(NOW, null, 30)).toBe(NOW + 30 * MIN);
  });
  it('con adfree vigente: extiende DESDE la caducidad (acumulable)', () => {
    expect(extendAdfree(NOW, NOW + 10 * MIN, 30)).toBe(NOW + 40 * MIN);
  });
  it('con adfree caducado: desde ahora', () => {
    expect(extendAdfree(NOW, NOW - 5 * MIN, 30)).toBe(NOW + 30 * MIN);
  });
});
```

- [ ] **Step 2: Implementar** — `adfree.ts`: las 2 funciones puras + storage (`getAdfreeUntil()`/`setAdfreeUntil(ts)` con AsyncStorage, clave `ads.adfree_until`, parseo defensivo → null si basura). En `queries.ts`: `shouldShowAds` añade parámetro `adfreeUntil?: number | null` — `if (isAdfreeActive(Date.now(), adfreeUntil)) return false;` (ACTUALIZA el test del Task 1 del plan anterior: nueva capa, mismo fail-closed). `AdBanner.tsx`: lee `adfreeUntil` (AsyncStorage en mount) y lo pasa al guard.

- [ ] **Step 3: RewardedCard** — `src/components/ads/RewardedCard.tsx` (solo no-premium y `config.rewarded.enabled`): preloading de `RewardedAd.createForAdRequest(__DEV__ ? TestIds.REWARDED : (process.env.EXPO_PUBLIC_ADMOB_REWARDED ?? ''), {...})` según doc instalada; al pulsar → `show()`; `onUserEarnedReward` (type `adfree_min`) → `extendAdfree` + persistir + refrescar gating (evento PostHog `ads_rewarded_completed`); `onAdFailedToShow`/load error → estado explícito. En `app/settings/premium.tsx`: la tarjeta bajo los productos, solo no-premium. Claves i18n `ads.rewarded_*` en los 5 JSON web.

- [ ] **Step 4: Gates + commit** — móvil: test/typecheck/lint en verde; commit `feat(ads): rewarded 30min sin anuncios con storage acumulable`.

---

### Task 3: Re-consentimiento UMP en Ajustes (cierra checklist pre-tráfico)

**Files:** Create `apps/mobile/app/settings/ads-privacy.tsx`; Modify `app/(tabs)/settings.tsx` (entrada), `src/lib/ads/consent.ts` si la doc exige algo nuevo, i18n.

- [ ] **Step 1:** Pantalla mínima: explica qué se consentió y botón "Gestionar opciones de anuncios" que re-ejecuta el flujo UMP (`requestAdsConsent()` del plan anterior — el pass-through de opciones ya existe) y muestra el resultado (`canRequestAds`) tras completar. Errores visibles. Entrada en Ajustes bajo Premium (icono `shield-outline`). Claves i18n `ads.privacy_*` ×5.
- [ ] **Step 2:** Gates (test/typecheck/lint móvil) + commit `feat(ads): entry point de re-consentimiento UMP (policy Google pre-trafico)`.

---

### Task 4: Presupuesto full-screen compartido + App Open

**Files:** Create `src/lib/ads/fullscreen.ts` + `fullscreen.test.ts`, `src/lib/ads/session-context.ts`, `src/hooks/ads/useAppOpenAd.ts`; Modify `app/_layout.tsx`, `src/lib/api/types.ts` si falta.

- [ ] **Step 1: Test primero** — `fullscreen.test.ts` (todo PURO, storage aparte):

```ts
import { describe, expect, it } from 'vitest';

import { canShowFullScreen, registerFullScreenShow } from './fullscreen.js';

const NOW = new Date('2026-10-07T12:00:00Z').getTime();
const MIN = 60_000;

const base = {
  enabled: true,
  now: NOW,
  lastShownAt: null as number | null,
  hourBucket: '2026-10-07T12' as string,
  showsThisHour: 0,
  sessionCount: 5, // grace: < 2 sesiones bloquea
  fromPush: false,
};

describe('canShowFullScreen (presupuesto compartido app open + interstitial)', () => {
  it('verde con todo limpio', () => {
    expect(canShowFullScreen(base)).toBe(true);
  });
  it('bloquea: dentro de las 2 primeras sesiones', () => {
    expect(canShowFullScreen({ ...base, sessionCount: 1 })).toBe(false);
    expect(canShowFullScreen({ ...base, sessionCount: 2 })).toBe(false);
    expect(canShowFullScreen({ ...base, sessionCount: 3 })).toBe(true);
  });
  it('bloquea: vino de push (ruta del gol)', () => {
    expect(canShowFullScreen({ ...base, fromPush: true })).toBe(false);
  });
  it('bloquea: mínimo 20 min desde el último show', () => {
    expect(canShowFullScreen({ ...base, lastShownAt: NOW - 19 * MIN })).toBe(false);
    expect(canShowFullScreen({ ...base, lastShownAt: NOW - 21 * MIN })).toBe(true);
  });
  it('bloquea: 2 shows ya en esta hora', () => {
    expect(canShowFullScreen({ ...base, showsThisHour: 2 })).toBe(false);
    expect(canShowFullScreen({ ...base, showsThisHour: 1 })).toBe(true);
  });
  it('cambia la hora ⇒ contador a cero', () => {
    expect(canShowFullScreen({ ...base, showsThisHour: 2, hourBucket: '2026-10-07T13' })).toBe(true);
  });
  it('formato desactivado ⇒ false', () => {
    expect(canShowFullScreen({ ...base, enabled: false })).toBe(false);
  });
});

describe('registerFullScreenShow', () => {
  it('devuelve lastShownAt=now y showsThisHour+1 (mismo bucket)', () => {
    const st = registerFullScreenShow(base, NOW);
    expect(st).toEqual({ lastShownAt: NOW, showsThisHour: 1, hourBucket: '2026-10-07T12' });
  });
});
```

- [ ] **Step 2: Implementar** — `fullscreen.ts`: `canShowFullScreen(state)` puro (orden de checks: enabled → sessionCount ≤ 2 → fromPush → minInterval 20 min → maxPerHour 2 con reset por bucket horario) + `registerFullScreenShow` puro + storage (`ads.fullscreen_state` en AsyncStorage: `{lastShownAt, showsThisHour, hourBucket}`). `session-context.ts`: `markPushInteraction()` + `consumePushInteraction(now)` (true si interacción hace < 60 s — la marca la pone el listener YA EXISTENTE en `_layout.tsx:81`; añadir ahí 1 línea) + contador de sesiones (`ads.session_count` en AsyncStorage, incrementado 1×/arranque en frío).

- [ ] **Step 3: App Open** — `useAppOpenAd.ts` (doc instalada para AppOpenAd): en frío en `app/_layout.tsx` (fuera de la ruta de push: `consumePushInteraction()` false Y `Notifications.getInitialNotification?` vacía — ver doc), config `appOpen.enabled`, caps del presupuesto compartido, máx 1 por arranque. Carga → `show()` cuando procede; errores explícitos.

- [ ] **Step 4: Gates + commit** — `feat(ads): presupuesto full-screen compartido + App Open (nunca tras push)`.

---

### Task 5: Interstitial al salir de ficha finalizada

**Files:** Create `src/hooks/ads/useInterstitialOnLeave.ts`; Modify `app/match/[id].tsx`.

- [ ] **Step 1:** Hook: captura el estado del partido al montar; en unmount/navegación atrás, si el partido NO estaba en vivo (`isEffectivelyLive` false — fuente única ya existente) → pide presupuesto compartido (`canShowFullScreen` + storage) → `InterstitialAd.createForAdRequest(__DEV__ ? TestIds.INTERSTITIAL : env, ...)` cargado previamente → `show()` → `registerFullScreenShow`. Sin partido finalizado, sin config, o presupuesto agotado → nada. Errores explícitos en logs.
- [ ] **Step 2:** Gates móviles + commit `feat(ads): interstitial al salir de ficha finalizada (presupuesto compartido)`.

---

### Task 6: Native in-feed (cada N items)

**Files:** Create `src/components/ads/NativeFeedAd.tsx`; Modify las 4 listas (index, standings, search, favorites).

- [ ] **Step 1:** Según doc instalada (`NativeAdView`): componente que carga un native ad (unit `EXPO_PUBLIC_ADMOB_NATIVE_FEED`, TestIds en dev) y lo renderiza con los tokens del tema (titular, cuerpo, media). Solo si `config.nativeFeed.enabled` && consent && !premium && !adfree (mismo guard). Colocación: item sintético cada `everyNItems` (8 default) en el FlatList de index y standings (search/favorites: sin native en v1 — listas cortas).
- [ ] **Step 2:** Gates móviles + commit `feat(ads): native in-feed cada N items (config-gated)`.

---

### Task 7: Cierre — analítica, docs, estado

- [ ] **Step 1:** Gates completos (typecheck/lint/test raíz) + `npx expo-doctor --cwd apps/mobile`.
- [ ] **Step 2:** Analítica: `ads_app_open_shown`, `ads_interstitial_shown`, `ads_rewarded_completed`, `ads_rewarded_failed` en `AnalyticsEventProps` (solo shows/earnings — impresiones/clicks los mide AdMob).
- [ ] **Step 3:** Docs: `docs/monetizacion.md §6` → Plan D implementado (tabla de envs de activación: `ADS_*_ENABLED`, `EXPO_PUBLIC_ADMOB_APP_OPEN/_INTERSTITIAL/_REWARDED/_NATIVE_FEED`); spec línea de estado; smoke manual en device queda PENDIENTE DE UN HUMANO (checklist ampliada con app open/interstitial/rewarded y geo-debug UMP vía `requestAdsConsent({ debugGeography, testDeviceIdentifiers })`).
- [ ] **Step 4:** Commit `feat(ads): Plan D formatos completos config-gated; activacion pendiente de datos`.

---

## Riesgos conocidos

1. **Doc instalada manda** (RewardedAd/AppOpenAd/InterstitialAd/NativeAdView cambian entre versiones — ya ocurrió con gatherConsent en el plan anterior).
2. **Todo nace apagado**: sin envs de activación, los formatos nuevos no existen en runtime (fail-safe). La activación es env + redeploy del API.
3. **Native in-feed es el task más pesado de UI** (NativeAdView + estilos por tema): si el smoke de banners aún no pasó, considerar partirelo a un plan propio.
4. **Smoke en device sigue PENDIENTE DE UN HUMANO** y ahora cubre más formatos: conviene hacerlo ANTES de activar cualquier env en producción.
5. **La chatarrería de contadores en AsyncStorage** (hour bucket, session count) es best-effort: un usuario que borre datos reinicia caps — aceptable para ads (no es seguridad).
