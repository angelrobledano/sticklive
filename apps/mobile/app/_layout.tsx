import { Stack, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import '../global.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AuthProvider } from '@/src/context/AuthContext';
import { LocaleProvider } from '@/src/i18n/LocaleContext';
import { ThemeProvider } from '@/src/theme/ThemeContext';
import { ApiError } from '@/src/lib/api/client';

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
      const urlPath = (data as { urlPath?: unknown } | null | undefined)?.urlPath;
      if (typeof urlPath === 'string' && urlPath.startsWith('/')) {
        router.push(urlPath as never);
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

// Con headerShown: false global, estos Stack.Screen son hoy inertes (el
// options.title que fijan las pantallas no llega a pintarse); el comportamiento
// real de los headers se decide en M5.
export default function RootLayout() {
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
