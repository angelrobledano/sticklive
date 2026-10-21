import { BRAND } from '@sports/brand';

export default {
  expo: {
    name: 'Stick Live',
    slug: 'sticklive',
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
      infoPlist: {
        NSUserTrackingUsageDescription:
          'Stick Live utiliza identificadores para personalizar anuncios y ofrecer resultados deportivos adaptados a tus preferencias.',
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
      // AndroidManifest y en Info.plist; requiere recompilar la app nativa (CNG/dev build).
      // androidAppId e iosAppId: usan variable de entorno en build si está definida o
      // los IDs de producción oficiales de Stick Live en AdMob.
      // delayAppMeasurementInit: doc del SDK (european-user-consent) — la
      // medición de Google arranca al abrir la app; con true espera a
      // initialize() o primera carga de ad, así un premium (que nunca llega a
      // initialize, gating de Task 4) tampoco genera actividad de medición.
      [
        'react-native-google-mobile-ads',
        {
          androidAppId:
            process.env['EXPO_PUBLIC_ADMOB_ANDROID_APP_ID'] ||
            'ca-app-pub-2994866776026136~4595623578',
          iosAppId:
            process.env['EXPO_PUBLIC_ADMOB_IOS_APP_ID'] ||
            'ca-app-pub-2994866776026136~6476786071',
          delayAppMeasurementInit: true,
        },
      ],
    ],
    experiments: { typedRoutes: true },
    // OTA (Task 5.3): runtime manual (el proyecto tiene directorio nativo para
    // builds locales → EAS lo trata como bare y no admite políticas). Subir a
    // mano SOLO cuando cambie código nativo; los updates JS viajan dentro.
    runtimeVersion: '1.0.0',
    updates: { url: 'https://u.expo.dev/cb441676-3b36-4fae-9ce6-2da8e9f918a3' },
    extra: {
      // `eas init --id cb441676-…` (la config es dinámica y el CLI no puede
      // escribir app.config.ts: lo aplicado a mano).
      eas: { projectId: 'cb441676-3b36-4fae-9ce6-2da8e9f918a3' },
      // DSN de la app móvil (env en build; vacío = Sentry.init no se llama).
      sentryDsn: process.env['EXPO_PUBLIC_SENTRY_DSN'] ?? '',
    },
  },
};
