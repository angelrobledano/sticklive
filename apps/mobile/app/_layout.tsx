import { Stack, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { PostHogProvider } from 'posthog-react-native';
import '../global.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AuthProvider } from '@/src/context/AuthContext';
import { LocaleProvider } from '@/src/i18n/LocaleContext';
import { ThemeProvider } from '@/src/theme/ThemeContext';
import { ApiError } from '@/src/lib/api/client';
import { capture, getPostHogClient } from '@/src/lib/analytics';

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
    const openFrom = (data: unknown) => {
      const payload = (data as { urlPath?: unknown; type?: unknown } | null | undefined) ?? {};
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
    void Notifications.getLastNotificationResponseAsync().then((r) =>
      openFrom(r?.notification.request.content.data),
    );
    const subscription = Notifications.addNotificationResponseReceivedListener((r) =>
      openFrom(r.notification.request.content.data),
    );
    return () => subscription.remove();
  }, []);
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
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="match/[id]" />
              <Stack.Screen name="team/[id]" />
              <Stack.Screen name="player/[id]" />
              <Stack.Screen name="settings/notifications" />
            </Stack>
          </QueryClientProvider>
        </LocaleProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}

// Con headerShown: false global, estos Stack.Screen son hoy inertes (el
// options.title que fijan las pantallas no llega a pintarse); el comportamiento
// real de los headers se decide en M5.
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
