# Stick Live Mobile (Android & iPhone) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar y consolidar la aplicación móvil de Stick Live con soporte multiplataforma para Android e iPhone (iOS), integrando AdMob de forma no intrusiva, añadiendo la pantalla de competición y asegurando paridad y calidad verificable.

**Architecture:** Expo SDK 57 con Expo Router, React Native y NativeWind v4 dentro del monorepo Turborepo (`apps/mobile`). Conexión a API REST y SSE de Stick Live con TanStack Query y react-native-sse. Monetización móvil mediante Google AdMob con CMP UMP europeo y fail-closed para usuarios premium.

**Tech Stack:** Expo SDK 57, React Native 0.86, React 19.2, TypeScript 5.4, Expo Router, NativeWind v4, react-native-google-mobile-ads, TanStack Query v5, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-app-movil-android-ios-design.md`

## Global Constraints

- Android package: `eu.sticklive.app`
- iOS bundle identifier: `eu.sticklive.app`
- Scheme: `sticklive`
- RuntimeVersion: manual `1.0.0`
- AdMob Android App ID: `ca-app-pub-2994866776026136~4595623578`
- AdMob iOS Test App ID: `ca-app-pub-3940256099942544~1458002511` (o env `EXPO_PUBLIC_ADMOB_IOS_APP_ID`)
- Test IDs en `__DEV__` de forma estricta (no tocar anuncios reales en desarrollo)
- No mostrar anuncios durante partidos en directo (`isAdQuietTime`)
- Compatibilidad estricta con Turborepo: `npm run typecheck && npm run lint && npm run test` deben pasar en verde

---

### Task 1: Soporte iOS en Configuración, EAS y Conectividad

**Files:**
- Modify: `apps/mobile/app.config.ts`
- Modify: `apps/mobile/eas.json`
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/src/lib/api/client.ts`
- Test: `apps/mobile/src/lib/api/client.test.ts`

**Interfaces:**
- Consumes: `process.env.EXPO_PUBLIC_API_URL`, `Platform.OS`
- Produces: `API_URL` resiliente para iOS simulator (`localhost`) y Android emulator (`10.0.2.2`), `app.config.ts` con `iosAppId` y permisos ATT.

- [ ] **Step 1: Añadir pruebas para resolución de `API_URL` cross-platform en `client.test.ts`**
- [ ] **Step 2: Ejecutar test para verificar fallo o comportamiento previo**
- [ ] **Step 3: Implementar resolución cross-platform de `API_URL` y configurar `app.config.ts`, `eas.json` y scripts en `package.json`**
- [ ] **Step 4: Ejecutar tests y exportación iOS para validar que no hay warnings ni errores**
- [ ] **Step 5: Commit de Task 1**

---

### Task 2: Ficha de Competición (`competition/[id].tsx`) y Navegación

**Files:**
- Create: `apps/mobile/app/competition/[id].tsx`
- Modify: `apps/mobile/app/(tabs)/search.tsx`
- Modify: `apps/mobile/app/(tabs)/favorites.tsx`
- Modify: `apps/mobile/app/match/[id].tsx`
- Modify: `apps/mobile/src/hooks/queries.ts`
- Test: `apps/mobile/src/hooks/queries.test.ts`

**Interfaces:**
- Consumes: `useCompetitions`, `useStandings`, endpoints `/competitions/:id/seasons` y `/seasons/:id/overview`
- Produces: Ruta `app/competition/[id].tsx` con pestañas Clasificación y Calendario, botón de seguir liga (`FollowButton kind="league"`).

- [ ] **Step 1: Escribir tests de queries y hook para detalle de competición**
- [ ] **Step 2: Verificar tests**
- [ ] **Step 3: Implementar pantalla `app/competition/[id].tsx` y enlazarla desde Search, Favorites y Match**
- [ ] **Step 4: Ejecutar vitest y typecheck en `@sports/mobile`**
- [ ] **Step 5: Commit de Task 2**

---

### Task 3: Verificación Integral de Calidad, Exportación y Documentación

**Files:**
- Modify: `docs/app.md`
- Test: Suite completa monorepo

- [ ] **Step 1: Ejecutar `npm run test` en `@sports/mobile` y a nivel de raíz**
- [ ] **Step 2: Ejecutar `npm run typecheck` y `npm run lint`**
- [ ] **Step 3: Ejecutar exportación de bundle para Android e iOS (`expo export`)**
- [ ] **Step 4: Actualizar `docs/app.md` con los perfiles y comandos de iOS y EAS**
- [ ] **Step 5: Commit de Task 3**
