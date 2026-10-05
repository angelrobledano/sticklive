import { Stack } from 'expo-router';
import '../global.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

// Con headerShown: false global, estos Stack.Screen son hoy inertes (el
// options.title que fijan las pantallas no llega a pintarse); el comportamiento
// real de los headers se decide en M5.
export default function RootLayout() {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <QueryClientProvider client={queryClient}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="match/[id]" />
            <Stack.Screen name="team/[id]" />
            <Stack.Screen name="player/[id]" />
          </Stack>
        </QueryClientProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
