import { View, Text } from 'react-native';
import { useLocale } from '@/src/i18n/LocaleContext';

export default function LiveScreen() {
  const { t } = useLocale();
  return (
    <View className="flex-1 items-center justify-center bg-rink-floor dark:bg-rink-floor-dark">
      <Text className="text-rink-passion font-bold">{t('nav.live')}</Text>
    </View>
  );
}
