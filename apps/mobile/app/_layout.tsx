import { Stack } from 'expo-router';
import '../global.css';
import { LocaleProvider } from '@/src/i18n/LocaleContext';
import { ThemeProvider } from '@/src/theme/ThemeContext';

// Solo se declara (tabs): match/[id], team/[id] y player/[id] llegan en M2 y,
// con typedRoutes: true, declararlos aquí rompería el typecheck hasta entonces.
export default function RootLayout() {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
      </LocaleProvider>
    </ThemeProvider>
  );
}
