import { BRAND } from '@sports/brand';

export default {
  expo: {
    name: 'Stick Live',
    slug: 'stick-live',
    scheme: 'sticklive',
    version: '1.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    icon: './assets/icon.png',
    // SDK 57: los assets de la plantilla son splash-icon.png y android-icon-foreground.png
    // (el plan asumía splash.png / adaptive-icon.png de plantillas anteriores).
    // El splash se configura abajo con el plugin expo-splash-screen (la clave
    // `splash` heredada ya no se usa).
    ios: {
      bundleIdentifier: 'eu.sticklive.app',
      supportsTablet: false,
      // iOS 18+: el sistema elige la variante según el aspecto de la pantalla de inicio.
      icon: {
        light: './assets/icon.png',
        dark: './assets/ios-icon-dark.png',
        tinted: './assets/ios-icon-tinted.png',
      },
    },
    android: {
      package: 'eu.sticklive.app',
      adaptiveIcon: {
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundColor: BRAND.granate,
        // Iconos temáticos de Android 13+.
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      edgeToEdgeEnabled: true,
    },
    plugins: [
      'expo-router',
      // Splash con el plugin recomendado (sustituye la clave `splash` heredada):
      // i sobre granate en claro y sobre noche en oscuro.
      [
        'expo-splash-screen',
        {
          image: './assets/splash-icon.png',
          imageWidth: 160,
          backgroundColor: BRAND.granate,
          dark: { image: './assets/splash-icon.png', backgroundColor: BRAND.noche },
        },
      ],
      'expo-status-bar',
      'expo-web-browser',
      'expo-secure-store',
      // expo-notifications: icono (blanco sobre transparente) y color del aviso
      // en Android, y canal por defecto de FCMv1 (el canal 'live' se crea en
      // runtime al registrarse). Requiere recompilar la app nativa (CNG) para
      // aplicar cambios.
      [
        'expo-notifications',
        { icon: './assets/notification-icon.png', color: BRAND.granate, defaultChannel: 'live' },
      ],
      // Sentry (Task 5.1): plugin nativo (el init de JS vive en app/_layout.tsx).
      // Publicar source maps además requiere sentryCli authToken como secret de
      // EAS en build — paso de release (5.3/5.4), no de esta tarea.
      ['@sentry/react-native/expo', {}],
      // OTA (Task 5.3): la URL de updates aún es placeholder hasta `eas init`
      // (mismo prerequisito humano de Task 4.2): sustituir <projectId> por el
      // ID real que devuelve `npx eas init`.
      'expo-updates',
      // AdMob (docs/monetizacion.md §6). El plugin inyecta el App ID en el
      // AndroidManifest; requiere recompilar la app nativa (CNG/dev build).
      // iOS pendiente de publicación: sin `iosAppId` el plugin SOLO avisa
      // (crashearía en un build iOS, que este hito Android-first no genera).
      // delayAppMeasurementInit: doc del SDK (european-user-consent) — la
      // medición de Google arranca al abrir la app; con true espera a
      // initialize() o primera carga de ad, así un premium (que nunca llega a
      // initialize, gating de Task 4) tampoco genera actividad de medición.
      [
        'react-native-google-mobile-ads',
        {
          androidAppId: 'ca-app-pub-2994866776026136~4595623578',
          delayAppMeasurementInit: true,
        },
      ],
    ],
    experiments: { typedRoutes: true },
    // OTA (Task 5.3): runtimeVersion derivada de `version` — cada release
    // pública lleva runtime propia y `eas update` sólo toca JS compatible.
    runtimeVersion: { policy: 'appVersion' },
    updates: { url: 'https://u.expo.dev/<projectId>' },
    extra: {
      eas: { projectId: '' }, // se rellena con `eas init` en M5 (push lo exige)
      // DSN de la app móvil (env en build; vacío = Sentry.init no se llama).
      sentryDsn: process.env['EXPO_PUBLIC_SENTRY_DSN'] ?? '',
    },
  },
};
