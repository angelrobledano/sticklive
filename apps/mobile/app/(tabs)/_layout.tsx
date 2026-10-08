import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { BRAND } from '@sports/brand';
import { useLocale } from '@/src/i18n/LocaleContext';

const ICONS = {
  index: 'radio-outline',
  standings: 'podium-outline',
  search: 'search-outline',
  favorites: 'star-outline',
  settings: 'settings-outline',
} as const;

export default function TabsLayout() {
  const { t } = useLocale();
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: BRAND.granate, // granate de marca
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('nav.live'), tabBarIcon: ({ color, size }) => <Ionicons name={ICONS.index} color={color} size={size} /> }} />
      <Tabs.Screen name="standings" options={{ title: t('nav.standings'), tabBarIcon: ({ color, size }) => <Ionicons name={ICONS.standings} color={color} size={size} /> }} />
      <Tabs.Screen name="search" options={{ title: t('nav.search'), tabBarIcon: ({ color, size }) => <Ionicons name={ICONS.search} color={color} size={size} /> }} />
      <Tabs.Screen name="favorites" options={{ title: t('nav.favorites'), tabBarIcon: ({ color, size }) => <Ionicons name={ICONS.favorites} color={color} size={size} /> }} />
      <Tabs.Screen name="settings" options={{ title: t('nav.settings'), tabBarIcon: ({ color, size }) => <Ionicons name={ICONS.settings} color={color} size={size} /> }} />
    </Tabs>
  );
}
