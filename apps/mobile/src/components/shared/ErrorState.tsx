import { Pressable, Text, View } from 'react-native';
import { useLocale } from '@/src/i18n/LocaleContext';

// Task 5.2: textos migrados a t() reutilizando las claves existentes de la web
// (errors.load_body / errors.retry); mismas copys para todas las pantallas.
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useLocale();
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Text className="text-center text-base text-slate-700 dark:text-slate-300">
        {t('errors.load_body')}
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        className="mt-3 min-h-[44px] justify-center rounded-lg bg-rink-passion px-4"
      >
        <Text className="text-center font-semibold text-white">{t('errors.retry')}</Text>
      </Pressable>
    </View>
  );
}
