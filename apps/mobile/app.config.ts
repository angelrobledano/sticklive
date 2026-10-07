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
    splash: { image: './assets/splash-icon.png', resizeMode: 'contain', backgroundColor: '#7f1d1d' },
    ios: { bundleIdentifier: 'eu.sticklive.app', supportsTablet: false },
    android: {
      package: 'eu.sticklive.app',
      adaptiveIcon: {
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundColor: '#7f1d1d',
      },
      edgeToEdgeEnabled: true,
    },
    plugins: [
      'expo-router',
      'expo-status-bar',
      'expo-web-browser',
      'expo-secure-store',
      // expo-notifications: color del aviso y canal por defecto de FCMv1 (el
      // canal 'live' se crea en runtime al registrarse). Requiere recompilar la
      // app nativa (CNG) para aplicar cambios.
      ['expo-notifications', { color: '#991b1b', defaultChannel: 'live' }],
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
