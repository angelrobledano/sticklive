import { Ionicons } from '@expo/vector-icons';
import { Pressable, type ColorValue } from 'react-native';
import { router } from 'expo-router';
import { useLocale } from '@/src/i18n/LocaleContext';

// Ajustes sale de las pestañas y se abre desde el engranaje de la cabecera
export function SettingsGearButton({ color }: { color?: ColorValue }) {
  const { t } = useLocale();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('nav.settings')}
      hitSlop={10}
      onPress={() => router.push('/settings')}
      style={{ paddingHorizontal: 12 }}
    >
      <Ionicons name="settings-outline" size={22} color={color} />
    </Pressable>
  );
}
