import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSession } from '@/src/context/AuthContext';
import { useLocale } from '@/src/i18n/LocaleContext';
import { authErrorKey } from '@/src/lib/auth-errors';

// Task 3.4 añadirá aquí las secciones de idioma/tema/notificaciones.
export default function SettingsScreen() {
  const { t } = useLocale();
  const { session, ready, lastAuthError, signInWithGoogle, signOut } = useSession();
  const [signingIn, setSigningIn] = useState(false);

  const handleSignIn = () => {
    setSigningIn(true);
    // signInWithGoogle captura sus fallos en lastAuthError (no lanza), pero el
    // finally garantiza reactivar el botón pase lo que pase.
    void signInWithGoogle().finally(() => setSigningIn(false));
  };

  return (
    <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
      <Text className="px-4 pt-4 text-2xl font-bold text-slate-900 dark:text-slate-100">
        {t('settings.title')}
      </Text>

      <View className="mx-4 mt-4 rounded-xl bg-white p-4 dark:bg-slate-900">
        <Text className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {t('settings.account_login')}
        </Text>
        <Text className="mt-0.5 text-sm text-slate-500">{t('settings.account_login_desc')}</Text>

        {!ready ? null : session ? (
          <>
            <Text
              className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300"
              accessibilityLabel={session.email ?? undefined}
            >
              {session.email}
            </Text>
            <Text className="mt-0.5 text-xs text-emerald-600">{t('settings.account_synced')}</Text>
            <Pressable
              onPress={() => void signOut()}
              className="mt-3 self-start rounded-lg border border-slate-300 px-4 py-2 active:opacity-70 dark:border-slate-600"
            >
              <Text className="font-semibold text-slate-700 dark:text-slate-300">
                {t('settings.logout')}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={handleSignIn}
              disabled={signingIn}
              className="mt-3 self-start rounded-lg bg-rink-passion px-4 py-2 active:opacity-80 disabled:opacity-50"
            >
              <Text className="font-semibold text-white">
                {signingIn ? t('auth.opening_account') : t('auth.google')}
              </Text>
            </Pressable>
            {lastAuthError ? (
              <Text
                className="mt-2 text-sm text-red-600 dark:text-red-400"
                accessibilityLiveRegion="polite"
              >
                {t(authErrorKey(lastAuthError))}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}
