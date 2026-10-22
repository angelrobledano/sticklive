import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { BRAND } from '@sports/brand';
import { useLocale } from '@/src/i18n/LocaleContext';
import { BrandHeaderTitle } from '@/src/components/layout/AppHeader';

const ICONS = {
  index: 'radio-outline',
  competitions: 'trophy-outline',
  search: 'search-outline',
  favorites: 'star-outline',
  settings: 'settings-outline',
} as const;

export default function TabsLayout() {
  const { t } = useLocale();
  // Paridad con la web (text-rink-passion dark:text-rink-accent): el granate se
  // queda en ~2:1 sobre el fondo oscuro, así que en oscuro el activo sube al
  // acento de marca.
  const { colorScheme } = useColorScheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerTitleStyle: { fontWeight: '700', fontSize: 18 },
        headerShadowVisible: false,
        headerTitleAlign: 'left',
        tabBarActiveTintColor: colorScheme === 'dark' ? BRAND.accent : BRAND.granate,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.live'),
          headerTitle: () => <BrandHeaderTitle />,
          tabBarIcon: ({ color, size }) => <Ionicons name={ICONS.index} color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="competitions"
        options={{
          title: t('navigation.competitions'),
          tabBarIcon: ({ color, size }) => <Ionicons name={ICONS.competitions} color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="standings"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: t('nav.search'),
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name={ICONS.search} color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: t('nav.favorites'),
          tabBarIcon: ({ color, size }) => <Ionicons name={ICONS.favorites} color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('nav.settings'),
          tabBarIcon: ({ color, size }) => <Ionicons name={ICONS.settings} color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
