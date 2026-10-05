import { Stack } from 'expo-router';
import '../global.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '@/src/i18n/LocaleContext';
import { ThemeProvider } from '@/src/theme/ThemeContext';

// A nivel de módulo: una única instancia para toda la app.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, staleTime: 30_000 } },
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
