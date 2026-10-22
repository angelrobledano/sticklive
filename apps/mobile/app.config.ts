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
      // Associated Domains (Universal Links): requiere que la cuenta de Apple Developer
      // tenga la capacidad activada en developer.apple.com.
      // Se desactiva si ENABLE_IOS_ASSOCIATED_DOMAINS='0' (para cuentas de prueba sin capability).
      ...(process.env['ENABLE_IOS_ASSOCIATED_DOMAINS'] !== '0'
        ? { associatedDomains: ['applinks:sticklive.eu'] }
        : {}),
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
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [
            {
              scheme: 'https',
              host: 'sticklive.eu',
              pathPrefix: '/login',
            },
            {
              scheme: 'https',
              host: 'sticklive.eu',
              pathPrefix: '/match',
            },
            {
              scheme: 'https',
              host: 'sticklive.eu',
              pathPrefix: '/competition',
            },
            {
              scheme: 'https',
              host: 'sticklive.eu',
              pathPrefix: '/team',
            },
          ],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
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
      // expo-notifications: icono, color, canal por defecto y sonidos deportivos propios
      [
        'expo-notifications',
        {
          icon: './assets/notification-icon.png',
          color: BRAND.granate,
          defaultChannel: 'live',
          sounds: [
            './assets/sounds/gol_favor.wav',
            './assets/sounds/gol_contra.wav',
            './assets/sounds/partido_inicio.wav',
            './assets/sounds/partido_final.wav',
            './assets/sounds/aviso_recordatorio.wav',
          ],
        },
      ],
      // Sentry (Task 5.1): el plugin de build inyecta tareas Gradle/Xcode de subida de sourcemaps.
      // Solo se activa si SENTRY_AUTH_TOKEN existe en los secrets de EAS para evitar
      // que sentry-cli falle el build si no hay credenciales configuradas.
      // El reporte de errores de JS vive en app/_layout.tsx y no requiere este plugin.
      ...(process.env['SENTRY_AUTH_TOKEN'] ? [['@sentry/react-native/expo', {}]] : []),
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
      './plugins/withWidget',
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
