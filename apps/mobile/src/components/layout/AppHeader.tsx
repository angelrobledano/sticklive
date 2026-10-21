import { Image, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from 'nativewind';
import { useLocale } from '@/src/i18n/LocaleContext';
import { shouldShowTodayButton } from '@/src/lib/header-helpers';

export { shouldShowTodayButton };

/**
 * Título de cabecera con el isotipo oficial de Stick Live (la 'i' con el stick y la bola de corcho)
 * y la tipografía de marca en contraste adaptativo.
 */
export function BrandHeaderTitle({ onPress }: { onPress?: () => void }) {
  const content = (
    <View className="flex-row items-center">
      <Image
        source={require('@/assets/brand-mark.png')}
        style={{ width: 28, height: 28, borderRadius: 7 }}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="Stick Live"
      />
      <View className="ml-2.5 flex-row items-baseline">
        <Text className="text-xl font-black tracking-tight text-slate-900 dark:text-white">
          STICK
        </Text>
        <Text className="ml-1 text-xl font-black tracking-tight text-rink-passion dark:text-rink-accent">
          LIVE
        </Text>
      </View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        className="active:opacity-70"
        accessibilityRole="button"
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

/**
 * Botón de búsqueda estándar para cabeceras secundarias (Clasificación, Favoritos).
 */
export function SearchHeaderButton() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const { t } = useLocale();

  return (
    <Pressable
      onPress={() => router.push('/(tabs)/search')}
      accessibilityLabel={t('nav.search')}
      hitSlop={8}
      className="mr-3 h-9 w-9 items-center justify-center rounded-full active:opacity-70"
    >
      <Ionicons
        name="search-outline"
        size={22}
        color={colorScheme === 'dark' ? '#f8fafc' : '#0f172a'}
      />
    </Pressable>
  );
}

interface HomeHeaderRightProps {
  selectedDate: string;
  todayKey: string;
  onResetToday: () => void;
  liveCount: number;
  isLiveFilterActive: boolean;
  onToggleLive: () => void;
}

/**
 * Acciones de la cabecera en la pantalla principal (Home):
 * - Botón "Hoy" cuando se consulta otra fecha en el calendario.
 * - Píldora de partidos "EN VIVO" con punto pulsante / activo.
 * - Botón de acceso directo a Búsqueda.
 */
export function HomeHeaderRight({
  selectedDate,
  todayKey,
  onResetToday,
  liveCount,
  isLiveFilterActive,
  onToggleLive,
}: HomeHeaderRightProps) {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const { t } = useLocale();

  const showToday = shouldShowTodayButton(selectedDate, todayKey);

  return (
    <View className="mr-3 flex-row items-center">
      {/* Botón rápido para volver al día de hoy */}
      {showToday && (
        <Pressable
          onPress={onResetToday}
          className="mr-2 flex-row items-center rounded-full bg-slate-200/80 px-2.5 py-1 active:opacity-70 dark:bg-slate-800"
          accessibilityLabel={t('common.today') || 'Hoy'}
        >
          <Ionicons
            name="today-outline"
            size={13}
            color={colorScheme === 'dark' ? '#94a3b8' : '#64748b'}
          />
          <Text className="ml-1 text-xs font-bold text-slate-700 dark:text-slate-300">
            {t('common.today') || 'Hoy'}
          </Text>
        </Pressable>
      )}

      {/* Píldora de partidos en directo */}
      {liveCount > 0 && (
        <Pressable
          onPress={onToggleLive}
          className={`mr-2 flex-row items-center rounded-full px-2.5 py-1 ${
            isLiveFilterActive
              ? 'bg-emerald-600'
              : 'border border-emerald-500/30 bg-emerald-500/15'
          }`}
          accessibilityLabel={`${liveCount} ${t('nav.live')}`}
        >
          <View
            className={`mr-1.5 h-2 w-2 rounded-full ${
              isLiveFilterActive ? 'bg-white' : 'bg-emerald-500'
            }`}
          />
          <Text
            className={`text-xs font-bold ${
              isLiveFilterActive ? 'text-white' : 'text-emerald-700 dark:text-emerald-400'
            }`}
          >
            {liveCount} {t('nav.live').toUpperCase()}
          </Text>
        </Pressable>
      )}

      {/* Acceso directo a búsqueda */}
      <Pressable
        onPress={() => router.push('/(tabs)/search')}
        accessibilityLabel={t('nav.search')}
        hitSlop={8}
        className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
      >
        <Ionicons
          name="search-outline"
          size={22}
          color={colorScheme === 'dark' ? '#f8fafc' : '#0f172a'}
        />
      </Pressable>
    </View>
  );
}
