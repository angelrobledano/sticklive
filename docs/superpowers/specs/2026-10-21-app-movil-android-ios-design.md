# Stick Live Mobile (Android & iPhone) — Especificación de Diseño y Arquitectura

- **Fecha:** 2026-10-21
- **Estado:** Validado / En implementación
- **Plataformas objetivo:** Android (Google Play) e iPhone/iOS (Apple App Store)
- **Tecnología:** Expo SDK 57 / React Native 0.86 / React 19.2 / TypeScript / NativeWind v4
- **Monorepo:** Turborepo (`apps/mobile`, `@sports/mobile`)

---

## 1. Resumen Ejecutivo y Auditoría del Contexto

Stick Live es una plataforma especializada en resultados y seguimiento en tiempo real de hockey sobre patines (producción: `https://sticklive.eu`). El ecosistema actual se compone de:

- **Monorepo Turborepo:** `apps/{api,web,mobile,scraper,etl}` y `packages/{brand,db,shared-types,analytics,logger}`.
- **Web / PWA:** Next.js 16 (App Router), SSR + client fetching, Google AdSense (`ca-pub-2994866776026136`), Google Funding Choices CMP (TCF v2.2), `ads.txt` / `app-ads.txt`.
- **API Backend:** Hono sobre Node.js (:3000), con endpoints REST micro-cacheados, SSE en tiempo real (`GET /matches/:id/stream`), pasarela de autenticación Google OAuth (`/auth/google`, `/auth/exchange`) ligada al `deviceId`, y suscripción a notificaciones push nativas (`/push/native/subscribe`).
- **Scraper & ETL:** Ingesta de fuentes oficiales (FEP / World Skate Europe), resolución de identidades de entidades, upserts idempotentes por `source_ref`, watchdog de partidos en directo y despachador de notificaciones push (`push-dispatcher.ts` + `push-expo.ts`).
- **App Móvil Existente (`apps/mobile`):** Base desarrollada en Expo SDK 57 con 155 pruebas unitarias en verde, ESLint sin advertencias y typecheck limpio, pero originalmente acotada a Android-first.

### El Mandato Actual
Desarrollar y consolidar la aplicación móvil nativa con soporte **simultáneo y de primera clase para Android e iPhone**, respetando la identidad visual, protegiendo la web y su monetización por AdSense, integrando AdMob de forma no intrusiva y sin inventar backend ficticio ni duplicar infraestructura.

---

## 2. Decisión Tecnológica y Arquitectura

### 2.1 Comparativa de Alternativas

| Criterio | Opción A: Capacitor / PWA Wrapper | Opción B: Flutter (desde cero) | Opción C: Expo / React Native (Elegida) |
|---|---|---|---|
| **Rendimiento en directo** | Pobre (DOM/Webview overhead) | Alto (Skia/Impeller) | Alto (Fabric / Hermes nativo) |
| **Reutilización de código** | Alta (copia de Next.js) | Nula (reescritura total en Dart) | Muy Alta (TypeScript, `@sports/*`, i18n JSONs) |
| **Integración AdMob** | Problemática (políticas Webview) | Buena (Google plugin) | Excelente (`react-native-google-mobile-ads` v17) |
| **Soporte Android + iOS** | Sí | Sí | Sí (EAS Cloud Build, CNG) |
| **Mantenibilidad Monorepo**| Desacoplada | Añade toolchain ajeno al repo | Unificada en Turborepo |
| **Coste y riesgo** | Experiencia no nativa | Muy costosa e innecesaria | Mínimo riesgo, base ya validada |

**Decisión:** **Expo SDK 57 (React Native)** en el workspace `apps/mobile`. Permite reutilizar el 100% de los tipos (`@sports/shared-types`), el sistema de diseño (`@sports/brand`), los diccionarios de traducción (`apps/web/src/locales/*.json`) y el cliente API seguro.

---

## 3. Estrategia de Monetización: AdSense (Web) vs AdMob (Móvil)

### 3.1 Separación Estricta Web vs Móvil
- **Web (`apps/web`):** Monetizada mediante **Google AdSense** (`ca-pub-2994866776026136`), gobernada por variables `NEXT_PUBLIC_ADSENSE_*` y consentimiento TCF v2.2 mediante Funding Choices. Intacta y sin alteraciones.
- **Móvil (`apps/mobile`):** Monetizada exclusivamente mediante **Google AdMob** (`ca-app-pub-2994866776026136~4595623578` para Android y `ca-app-pub-3940256099942544~1458002511` como ID de test iOS mientras se registra el ID productivo).

### 3.2 Formatos y Políticas de Ubicación
1. **Banners Adaptativos Anclados (`AdBanner`):**
   - Aparecen al pie de las listas (Directo, Clasificación, Búsqueda, Favoritos) y en la ficha de partido finalizada o previa.
   - En partidos en directo (`status === 'live'`, `isAdQuietTime`), **el banner se oculta completamente**.
2. **Intersticial entre Pantallas (`useInterstitialOnLeave`):**
   - Solo se evalúa al salir de una ficha de partido que **no está en directo**.
   - Límites estrictos (caps): período de gracia de 2 sesiones sin anuncios a pantalla completa, intervalo mínimo de 20 minutos entre impresiones y máximo 2 por hora compartidas con App Open.
3. **Vídeo con Recompensa (Rewarded / Ad-Free):**
   - Ofrece al usuario 30 minutos de navegación completamente libre de anuncios a cambio de ver un anuncio de vídeo voluntario (`useAdfreeUntil`).
4. **Nativo en Feed (`NativeFeedAd`):**
   - Una única inserción tras el elemento N de la lista en partidos/clasificación, con estilos coherentes con el tema claro/oscuro.

### 3.3 Privacidad, Consentimiento UMP y Gating Premium
- **Google UMP (User Messaging Platform):** Consentimiento obligatorio para el EEE, UK y Suiza. Implementado como singleton (`ensureAdsConsent`).
- **Re-consentimiento en Ajustes:** Acceso explícito a `manageAdsConsent` desde `settings/ads-privacy.tsx` para permitir revocar o modificar consentimientos según la normativa europea.
- **Fail-Closed:** Si el usuario no otorga consentimiento o si la carga falla, no se solicitan anuncios ni se reservan espacios vacíos.
- **Gating Premium:** Los usuarios con suscripción activa (anual o lifetime leída desde `/payments/status`) tienen un bloqueo inmediato que retorna `null` antes de tocar el SDK de Google, garantizando cero llamadas de red y cero rastreo.

---

## 4. Soporte Multiplataforma: Android e iPhone (iOS)

Para cumplir el requisito mandatorio de soporte completo para iPhone y Android, se resuelven las siguientes carencias:

1. **Configuración de AdMob para iOS en `app.config.ts`:**
   - Asignar `iosAppId: process.env.EXPO_PUBLIC_ADMOB_IOS_APP_ID || 'ca-app-pub-3940256099942544~1458002511'`.
   - Incluir `userTrackingPermission` en `ios.infoPlist` para describir el uso de ATT de conformidad con las directrices del App Store.
2. **Perfiles de Build EAS para iOS (`eas.json`):**
   - Configurar `build.development.ios` (con `simulator: true` para pruebas locales sin cuenta de pago).
   - Configurar `build.preview.ios` y `build.production.ios` para TestFlight y App Store.
3. **Conectividad de Red Cross-Platform (`src/lib/api/client.ts`):**
   - En Android Emulator la máquina host es `10.0.2.2`.
   - En iOS Simulator la máquina host es `localhost`.
   - Ajustar el fallback para que detecte `Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000'`.
4. **Scripts de Exportación y Compilación (`package.json`):**
   - Actualizar `"build"` para exportar ambas plataformas (`expo export`), y añadir `"build:android"` y `"build:ios"`.
   - Añadir script `"ios": "expo run:ios"`.

---

## 5. Experiencia de Usuario y Arquitectura de Pantallas

### 5.1 Navegación Principal (Tabs)
- **Partidos / Hoy (`(tabs)/index.tsx`):** Partidos en directo destacados con badge animado en verde (`BRAND.live`), seguidos por partidos organizados por fecha y competición. Pull-to-refresh nativo.
- **Competiciones / Clasificación (`(tabs)/standings.tsx`):** Selector horizontal de ligas activas y tabla completa de clasificación (PJ, G, E, D, GF, GC, Puntos).
- **Búsqueda (`(tabs)/search.tsx`):** Búsqueda en tiempo real con debounce de 300 ms de equipos, jugadores y competiciones.
- **Favoritos (`(tabs)/favorites.tsx`):** Seguimiento de equipos, ligas y jugadores, con persistencia local anónima y sincronización en la nube tras login con Google.
- **Ajustes (`(tabs)/settings.tsx`):** Gestión de cuenta, notificaciones push, tema claro/oscuro/sistema, privacidad de anuncios y estado premium.

### 5.2 Rutas de Detalle y Paridad con la Web
- **Ficha de Partido (`match/[id].tsx`):** Conexión SSE en tiempo real a `GET /matches/:id/stream` con recarga de eventos (goles, tarjetas, faltas, alineaciones) y fallback automático a polling en caso de micro-cortes.
- **Ficha de Equipo (`team/[id].tsx`):** Escudo, posición actual, partidos de la temporada y plantilla con botón de seguimiento.
- **Ficha de Jugador (`player/[id].tsx`):** Foto, equipo actual, estadísticas y posición.
- **Ficha de Competición (`competition/[id].tsx` — Nueva pantalla de paridad):** Detalle completo de la competición, temporadas históricas, tabla de posiciones y calendario de jornadas, enlazable desde búsqueda, partidos y favoritos.

---

## 6. Notificaciones Push y Funciones Nativas

- **Canal Nativo:** Expo Notifications integrado con FCM v1 (Android) y APNs (iOS).
- **Contrato con ETL:** El servidor segmenta los avisos según los favoritos del usuario (`push_tokens`) y envía los lotes mediante Expo Push API con `channelId: 'live'`, `collapseId` por partido y TTL de 1 hora.
- **Deep Linking:** Al pulsar una notificación de gol o resultado, la app captura el payload `data.urlPath` (`/match/<id>`) y navega directamente a la ficha del partido, registrando el evento de analítica `notification_opened` en PostHog.

---

## 7. Plan de Ejecución por Fases

1. **Fase 1 (Soporte iOS y Conectividad):**
   - Configurar `iosAppId` y permisos en `app.config.ts`.
   - Configurar perfiles iOS en `eas.json`.
   - Ajustar detección de entorno en `client.ts` para iOS Simulator.
   - Añadir scripts de build para iOS en `package.json`.
2. **Fase 2 (Pantalla de Competición y Navegación):**
   - Crear `app/competition/[id].tsx` consumiendo `GET /seasons/:id/overview` y `GET /competitions/:id/seasons`.
   - Conectar los enlaces de competición desde `search.tsx`, `favorites.tsx` y `match/[id].tsx`.
3. **Fase 3 (Verificación y Pruebas):**
   - Añadir pruebas unitarias para la nueva lógica y compatibilidad iOS.
   - Ejecutar `typecheck`, `lint` y suite de tests Vitest en `@sports/mobile`.
   - Ejecutar `expo export` tanto para Android como para iOS verificando la generación limpia de los bundles Hermes.
4. **Fase 4 (Documentación de Release):**
   - Actualizar `docs/app.md` con los runbooks de build y submit para iOS / Apple App Store.
