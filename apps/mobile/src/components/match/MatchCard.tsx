import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useLocale } from '@/src/i18n/LocaleContext';
import { formatKickoff, isEffectivelyLive } from '@/src/lib/time';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import type { MatchSummary } from '@/src/lib/api/types';

export function MatchCard({ match }: { match: MatchSummary }) {
  const router = useRouter();
  const { t } = useLocale();
  // EN VIVO solo si la fuente lo da en juego (la hora no fabrica directos;
  // misma regla que la web y el API).
  const live = isEffectivelyLive(match.status, match.scheduledAt);
  const showScore = live || match.status === 'finished';

  const homeName = match.homeTeam.shortName ?? match.homeTeam.name;
  const awayName = match.awayTeam.shortName ?? match.awayTeam.name;

  return (
    <Pressable
      onPress={() => router.push(`/match/${match.id}`)}
      accessibilityRole="button"
      className="mx-3 my-1 rounded-xl bg-white p-3 active:opacity-70 dark:bg-slate-900 border border-slate-100 dark:border-slate-800"
    >
      {match.competitionName ? (
        <Text className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
          {match.competitionName}
        </Text>
      ) : null}

      <View className="flex-row items-center justify-between">
        {/* Local: Escudo + Nombre */}
        <View className="flex-1 flex-row items-center gap-2 pr-1">
          <Avatar
            uri={teamLogoUri(match.homeTeam.id, 64)}
            fallbackUri={match.homeTeam.logoUrl}
            name={homeName}
            size={26}
          />
          <Text
            className="flex-1 text-sm font-semibold text-slate-900 dark:text-slate-100"
            numberOfLines={1}
          >
            {homeName}
          </Text>
        </View>

        {/* Marcador central o Kickoff */}
        <View className="items-center px-2 min-w-[70px]">
          {showScore ? (
            <Text className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {match.score.home ?? 0} - {match.score.away ?? 0}
            </Text>
          ) : (
            <Text className="font-mono text-sm font-semibold text-slate-600 dark:text-slate-300">
              {formatKickoff(match.scheduledAt)}
            </Text>
          )}
        </View>

        {/* Visitante: Nombre + Escudo */}
        <View className="flex-1 flex-row items-center justify-end gap-2 pl-1">
          <Text
            className="flex-1 text-right text-sm font-semibold text-slate-900 dark:text-slate-100"
            numberOfLines={1}
          >
            {awayName}
          </Text>
          <Avatar
            uri={teamLogoUri(match.awayTeam.id, 64)}
            fallbackUri={match.awayTeam.logoUrl}
            name={awayName}
            size={26}
          />
        </View>
      </View>

      {/* Pie: Estado (Final / Descanso / En directo) */}
      <View className="mt-2 flex-row items-center justify-between">
        <Text className="text-xs text-slate-500 font-medium">
          {match.status === 'finished'
            ? t('match_states.final')
            : match.isHalftime
              ? t('match_states.half_time')
              : ''}
        </Text>
        {live ? (
          <View className="flex-row items-center gap-1 rounded-full bg-live-deep px-2 py-0.5">
            <View className="h-1.5 w-1.5 rounded-full bg-white" />
            <Text className="text-[10px] font-bold text-white">{t('match_states.live')}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
