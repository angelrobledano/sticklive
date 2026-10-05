import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useLocale } from '@/src/i18n/LocaleContext';
import { formatKickoff, isEffectivelyLive } from '@/src/lib/time';
import type { MatchSummary } from '@/src/lib/api/types';

// Sin logo de equipo: imágenes remotas requieren configurar cache de Expo Image
// (se evalúa en M5; YAGNI por ahora).
export function MatchCard({ match }: { match: MatchSummary }) {
  const router = useRouter();
  const { t } = useLocale();
  // status crudo del listado (/current): el badge "en vivo por reloj" lo
  // calcula la UI con STALE_LIVE_HOURS (misma regla que la web y el API).
  const live = isEffectivelyLive(match.status, match.scheduledAt);
  const showScore = live || match.status === 'finished';

  return (
    <Pressable
      onPress={() => router.push(`/match/${match.id}`)}
      accessibilityRole="button"
      className="mx-3 my-1 rounded-xl bg-white p-3 active:opacity-70 dark:bg-slate-900"
    >
      {match.competitionName ? (
        <Text className="text-[10px] uppercase tracking-wide text-slate-500">
          {match.competitionName}
        </Text>
      ) : null}
      <View className="mt-1 flex-row items-center justify-between">
        <Text className="flex-1 text-base font-semibold text-slate-900 dark:text-slate-100" numberOfLines={1}>
          {match.homeTeam.shortName ?? match.homeTeam.name}
        </Text>
        <Text className="px-2 font-mono text-lg font-bold text-slate-900 dark:text-slate-100">
          {showScore ? `${match.score.home ?? 0} - ${match.score.away ?? 0}` : formatKickoff(match.scheduledAt)}
        </Text>
        <Text className="flex-1 text-right text-base font-semibold text-slate-900 dark:text-slate-100" numberOfLines={1}>
          {match.awayTeam.shortName ?? match.awayTeam.name}
        </Text>
      </View>
      <View className="mt-1 flex-row items-center justify-between">
        <Text className="text-xs text-slate-500">
          {match.status === 'finished' ? t('match_states.final') : match.isHalftime ? t('match_states.half_time') : ''}
        </Text>
        {live ? (
          <View className="rounded-full bg-rink-passion px-2 py-0.5">
            <Text className="text-[10px] font-bold text-white">{t('match_states.live')}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
