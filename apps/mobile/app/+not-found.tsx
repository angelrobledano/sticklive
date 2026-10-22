import { Link, Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { useLocale } from '@/src/i18n/LocaleContext';

/**
 * Fallback para rutas o deep links no reconocidos en la app móvil.
 * Evita pantallas de error rojas o pantallas 404 feas de Expo Router.
 */
export default function NotFoundScreen() {
  const { t } = useLocale();

  return (
    <>
      <Stack.Screen options={{ title: t('errors.not_found_title') }} />
      <View className="flex-1 items-center justify-center bg-rink-floor p-6 dark:bg-rink-floor-dark">
        <Text className="text-xl font-bold text-slate-900 dark:text-slate-100">
          {t('errors.not_found_title')}
        </Text>
        <Text className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
          {t('errors.not_found_body')}
        </Text>
        <Link
          href="/"
          className="mt-6 rounded-xl bg-rink-passion px-5 py-3 active:opacity-80"
        >
          <Text className="font-semibold text-white">
            {t('errors.not_found_home')}
          </Text>
        </Link>
      </View>
    </>
  );
}
