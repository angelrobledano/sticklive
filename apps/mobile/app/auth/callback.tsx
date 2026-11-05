import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '@/src/context/AuthContext';
import { useLocale } from '@/src/i18n/LocaleContext';

/**
 * Endpoint de deep link para OAuth (Google): sticklive://auth/callback?code=...&email=...
 * En Android, el navegador externo o Custom Tab dispara el intent al sistema
 * operativo, y Expo Router navega a esta ruta. Canjea el código de forma
 * atómica y deduplicada (vía AuthContext.exchangeAuthCode) y redirige a Ajustes.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const { t } = useLocale();
  const { code, error, email } = useLocalSearchParams<{
    code?: string;
    error?: string;
    email?: string;
  }>();
  const { exchangeAuthCode, setLastAuthError, session } = useSession();

  useEffect(() => {
    let active = true;

    async function handleAuth() {
      if (error) {
        setLastAuthError(error);
        if (active) {
          router.replace('/settings');
        }
        return;
      }

      if (code) {
        await exchangeAuthCode(code, email);
      }

      if (active) {
        router.replace('/settings');
      }
    }

    // Si ya hay una sesión activa, volvemos a ajustes directamente
    if (session) {
      router.replace('/settings');
      return;
    }

    void handleAuth();

    return () => {
      active = false;
    };
  }, [code, error, email, exchangeAuthCode, setLastAuthError, session, router]);

  return (
    <View className="flex-1 items-center justify-center bg-rink-floor p-6 dark:bg-rink-floor-dark">
      <ActivityIndicator size="large" color="#7a1c30" />
      <Text className="mt-4 text-base font-medium text-slate-700 dark:text-slate-300">
        {t('auth.opening_account')}
      </Text>
    </View>
  );
}
