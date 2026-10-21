import { Stack, router, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { PostHogProvider } from 'posthog-react-native';
import '../global.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useColorScheme } from 'nativewind';
import { AuthProvider } from '@/src/context/AuthContext';
import { LocaleProvider, useLocale } from '@/src/i18n/LocaleContext';
import { ThemeProvider } from '@/src/theme/ThemeContext';
import { NAV_DARK, NAV_LIGHT } from '@/src/theme/navigation';
import { ApiError } from '@/src/lib/api/client';
import { capture, getPostHogClient } from '@/src/lib/analytics';
import { markPushInteraction } from '@/src/lib/ads/session-context';
import { useAppOpenAd } from '@/src/hooks/ads/useAppOpenAd';

// Sentry (Task 5.1): init a nivel de módulo, ANTES de renderizar nada, y SOLO
// si hay DSN (en desarrollo sin DSN no se inicializa y no hay overhead). El
// DSN viene del extra.sentryDsn que app.config.ts inyecta desde
// EXPO_PUBLIC_SENTRY_DSN en build: es el DSN de la app móvil en el proyecto
// Sentry — NUNCA el DSN del servidor.
const sentryDsn = (Constants.expoConfig?.extra as { sentryDsn?: string } | undefined)?.sentryDsn ?? '';
if (sentryDsn) {
  Sentry.init({ dsn: sentryDsn, tracesSampleRate: 0.1 });
}

// PostHog (Task 5.1): cliente ÚNICO de src/lib/analytics.ts (los captures de
// toda la app pasan por allí) compartido con el provider, que solo aporta el
// contexto de usePostHog. Con autocapture={false} ni toques ni pantallas; sin
// key (getPostHogClient() → null) no se monta provider y la analítica es no-op.
// La rama es constante durante toda la ejecución: no hay remontajes.
const posthogClient = getPostHogClient();

// A nivel de módulo: una única instancia para toda la app.
// El retry no reintenta 4xx (404/401 no se arreglan reintentando); 5xx y red sí.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 2,
      staleTime: 30_000,
    },
  },
});

// Handler de presentación (Task 4.2): con la app en primer plano las
// notificaciones se muestran como banner y en la lista, con sonido, sin badge.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Deep link de apertura (Task 4.2): el emisor incluye `data.urlPath` (p. ej.
 * '/match/<id>') y el tap abre esa ruta. Cubre app cerrada (última respuesta)
 * y app abierta en segundo plano (listener). Patrón de la doc de expo-router
 * (v57, "Handle push notifications with navigation").
 */
function useNotificationDeepLink() {
  useEffect(() => {
    const openFrom = (response: Notifications.NotificationResponse | null | undefined) => {
      // Plan D (invariante 1, la ruta del gol): SOLO una respuesta REAL de
      // notificación es una interacción de push. En un arranque normal la
      // promesa de abajo resuelve null — marcar ese null convertía TODO
      // arranque en "ruta del gol" durante 60 s y dejaba el app open
      // inalcanzable (bug del review). La ventana de 60 s corre desde el tap.
      if (response) markPushInteraction();
      const payload =
        (response?.notification.request.content.data as
          | { urlPath?: unknown; type?: unknown }
          | null
          | undefined) ?? {};
      const urlPath = payload.urlPath;
      if (typeof urlPath === 'string' && urlPath.startsWith('/')) {
        router.push(urlPath as never);
      }
      // Analítica (Task 5.1): apertura de una NOTIFICACIÓN. El emisor (ETL)
      // pone `type` en data; un deep link sin type (p. ej. un enlace manual)
      // no es apertura de push y no se cuenta. La propiedad es
      // `notification_type`, la misma que notification_sent (ETL) y el SW web:
      // el CTR por tipo agrupa ambas plataformas en el mismo desglose.
      if (typeof payload.type === 'string') {
        capture('notification_opened', { notification_type: payload.type });
      }
    };
    void Notifications.getLastNotificationResponseAsync().then((r) => openFrom(r));
    const subscription = Notifications.addNotificationResponseReceivedListener((r) =>
      openFrom(r),
    );
    return () => subscription.remove();
  }, []);
}

/**
 * App Open en frío (Plan D Task 4): gate SIN UI (el anuncio lo presenta el
 * SDK nativo). Decide UNA vez por arranque con la config remota, el
 * presupuesto full-screen compartido y la ruta del gol — detalles en el hook.
 * Debe vivir DENTRO de QueryClientProvider (usa useAdsConfig) y bajo
 * AuthProvider (usePremiumStatus): por eso es hermano del Stack.
 */
function AppOpenAdGate() {
  useAppOpenAd();
  return null;
}

function AppTree() {
  useNotificationDeepLink();

  return (
    // AuthProvider lo más externo: no depende de tema/idioma (solo de la red y
    // SecureStore) y deja la sesión disponible para cualquier provider interno.
    <AuthProvider>
      <ThemeProvider>
        <LocaleProvider>
          <QueryClientProvider client={queryClient}>
            <AppOpenAdGate />
            <RootNavigator />
          </QueryClientProvider>
        </LocaleProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}

/**
 * Cabeceras activas: la ficha de partido, equipo y jugador ya definen su título
 * (Stack.Screen options) y ahora reciben además el botón de volver; los ajustes
 * fijan el suyo aquí, centralizado e internacionalizado. Las pestañas conservan
 * su propia cabecera. El tema de navegación sigue el esquema real de la app
 * (claro/oscuro manual de Ajustes incluido): sin él, cabecera y pestañas se
 * quedan claras en oscuro.
 */
function RootNavigator() {
  const { colorScheme } = useColorScheme();
  const { t } = useLocale();
  const navTheme = colorScheme === 'dark' ? NAV_DARK : NAV_LIGHT;

  return (
    <NavigationThemeProvider value={navTheme}>
      <Stack screenOptions={{ headerShown: true, headerTitleStyle: { fontWeight: '700' } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="match/[id]" />
        <Stack.Screen name="team/[id]" />
        <Stack.Screen name="player/[id]" />
        <Stack.Screen name="competition/[id]" />
        <Stack.Screen name="settings/notifications" options={{ title: t('settings.notif_title') }} />
        <Stack.Screen name="settings/premium" options={{ title: t('premium.title') }} />
        <Stack.Screen name="settings/ads-privacy" options={{ title: t('ads.privacy_title') }} />
        <Stack.Screen name="login" options={{ title: t('auth.login_title') }} />
      </Stack>
    </NavigationThemeProvider>
  );
}

function RootLayout() {
  return posthogClient ? (
    <PostHogProvider client={posthogClient} autocapture={false}>
      <AppTree />
    </PostHogProvider>
  ) : (
    <AppTree />
  );
}

// Sentry.wrap: error boundary global + rendimiento del root alrededor del árbol.
export default Sentry.wrap(RootLayout);
