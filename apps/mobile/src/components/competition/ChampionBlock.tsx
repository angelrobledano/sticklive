import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { useLocale } from '@/src/i18n/LocaleContext';
import { clubName } from '@sports/core/names';

interface ChampionTeam {
  id: string;
  name: string;
  shortName?: string | null;
  logoUrl?: string | null;
}

interface Props {
  team: ChampionTeam;
}

export function ChampionBlock({ team }: Props) {
  const router = useRouter();
  const { t } = useLocale();

  const displayName = clubName(team.name) || team.shortName || team.name;

  return (
    <Pressable
      onPress={() => router.push(`/team/${team.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Campeón: ${displayName}`}
      className="mb-4 flex-row items-center gap-3 overflow-hidden rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5 active:opacity-75 dark:bg-amber-500/15"
    >
      <View className="flex-row items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1 shadow-xs">
        <Ionicons name="trophy" size={14} color="#ffffff" />
        <Text className="text-[10px] font-extrabold uppercase tracking-widest text-white">
          {t('playoffs.champion') || 'Campeón'}
        </Text>
      </View>

      <Avatar
        uri={teamLogoUri(team.id, 64)}
        fallbackUri={team.logoUrl}
        name={displayName}
        size={36}
      />

      <Text
        numberOfLines={1}
        className="flex-1 text-base font-bold text-slate-900 dark:text-slate-50"
      >
        {displayName}
      </Text>

      <Ionicons name="chevron-forward" size={18} color="#f59e0b" />
    </Pressable>
  );
}
