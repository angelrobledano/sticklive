import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocale } from '@/src/i18n/LocaleContext';
import type { DayFilter } from '@/src/lib/day-view';

interface DayChipsProps {
  liveCount: number;
  followingCount: number;
  filter: DayFilter;
  onChange: (filter: DayFilter) => void;
}

export function DayChips({ liveCount, followingCount, filter, onChange }: DayChipsProps) {
  const { t } = useLocale();

  if (liveCount === 0 && followingCount === 0) return null;

  return (
    <View className="flex-row items-center gap-2 px-3 py-2">
      {liveCount > 0 && (
        <Pressable
          onPress={() => onChange(filter === 'live' ? 'all' : 'live')}
          className={`h-8 flex-row items-center gap-1.5 rounded-full border px-3 ${
            filter === 'live'
              ? 'border-live-deep bg-live-deep'
              : 'border-emerald-600/30 bg-white dark:bg-slate-900'
          }`}
        >
          <View
            className={`h-2 w-2 rounded-full ${
              filter === 'live' ? 'bg-white' : 'bg-emerald-500'
            }`}
          />
          <Text
            className={`text-xs font-semibold ${
              filter === 'live' ? 'text-white' : 'text-emerald-700 dark:text-emerald-400'
            }`}
          >
            {t('match_states.live')}
          </Text>
          <View
            className={`rounded-full px-1.5 py-0.2 ${
              filter === 'live' ? 'bg-white/20' : 'bg-emerald-50 dark:bg-emerald-950/50'
            }`}
          >
            <Text
              className={`text-[10px] font-bold ${
                filter === 'live' ? 'text-white' : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {liveCount}
            </Text>
          </View>
        </Pressable>
      )}

      {followingCount > 0 && (
        <Pressable
          onPress={() => onChange(filter === 'following' ? 'all' : 'following')}
          className={`h-8 flex-row items-center gap-1.5 rounded-full border px-3 ${
            filter === 'following'
              ? 'border-rink-passion bg-rink-passion'
              : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900'
          }`}
        >
          <Ionicons
            name="star"
            size={12}
            color={filter === 'following' ? '#ffffff' : '#eab308'}
          />
          <Text
            className={`text-xs font-semibold ${
              filter === 'following' ? 'text-white' : 'text-slate-700 dark:text-slate-200'
            }`}
          >
            {t('favorites.filter_following')}
          </Text>
          <View
            className={`rounded-full px-1.5 py-0.2 ${
              filter === 'following' ? 'bg-white/20' : 'bg-slate-100 dark:bg-slate-800'
            }`}
          >
            <Text
              className={`text-[10px] font-bold ${
                filter === 'following' ? 'text-white' : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              {followingCount}
            </Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}
