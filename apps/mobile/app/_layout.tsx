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

// Solo se declara (tabs): match/[id], team/[id] y player/[id] llegan en M2 y,
// con typedRoutes: true, declararlos aquí rompería el typecheck hasta entonces.
export default function RootLayout() {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <QueryClientProvider client={queryClient}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
        </QueryClientProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
