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
    plugins: ['expo-router', 'expo-status-bar'],
    experiments: { typedRoutes: true },
    extra: { eas: { projectId: '' } }, // se rellena con `eas init` en M5
  },
};
