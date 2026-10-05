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
    ],
    experiments: { typedRoutes: true },
    extra: {
      eas: { projectId: '' }, // se rellena con `eas init` en M5 (push lo exige)
      // DSN de la app móvil (env en build; vacío = Sentry.init no se llama).
      sentryDsn: process.env['EXPO_PUBLIC_SENTRY_DSN'] ?? '',
    },
  },
};
