import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ClubTeamSummary } from '@sports/core/api';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { useLocale } from '@/src/i18n/LocaleContext';

interface Props {
  clubTeams?: ClubTeamSummary[];
}

export function OtherClubTeams({ clubTeams }: Props) {
  const { t } = useLocale();
  const router = useRouter();

  if (!clubTeams || clubTeams.length === 0) return null;

  return (
    <View className="mx-3 mt-3 overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
      <View className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800">
        <Text className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {t('team.other_teams') || 'Altres equips del club'}
        </Text>
      </View>
      <View className="divide-y divide-slate-100 dark:divide-slate-800/60">
        {clubTeams.map((ct) => (
          <Pressable
            key={ct.id}
            onPress={() => router.push(`/team/${ct.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${ct.name}${ct.sectionSuffix ? `, ${ct.sectionSuffix}` : ''}`}
            className="min-h-[48px] flex-row items-center gap-3 px-4 py-3 active:bg-slate-50 dark:active:bg-slate-800/60"
          >
            <Avatar uri={teamLogoUri(ct.id, 64)} name={ct.name} size={28} />
            <View className="flex-1 min-w-0">
              <Text numberOfLines={1} className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {ct.name}
              </Text>
              {ct.sectionSuffix ? (
                <Text className="text-xs text-slate-500">{ct.sectionSuffix}</Text>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
