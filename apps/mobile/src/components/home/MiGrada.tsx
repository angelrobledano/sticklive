import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { MatchSummary } from '@/src/lib/api/types';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { useLocale } from '@/src/i18n/LocaleContext';
import { clubName } from '@/src/lib/names';
import { formatDayShort, formatKickoff } from '@/src/lib/time';
import { madridDateKey } from '@sports/core/match-time';
import { selectGradaMatches } from '@/src/lib/grada';

interface Props {
  matches: MatchSummary[];
  teamIds: string[];
  leagueIds: string[];
}

export function MiGrada({ matches, teamIds, leagueIds }: Props) {
  const router = useRouter();
  const { t, locale } = useLocale();

  const todayKey = useMemo(() => madridDateKey(new Date().toISOString()), []);

  const { upcoming, results } = useMemo(
    () => selectGradaMatches(matches, { teamIds, leagueIds, todayKey, limit: 4 }),
    [matches, teamIds, leagueIds, todayKey],
  );

  if (teamIds.length === 0 && leagueIds.length === 0) return null;
  if (upcoming.length === 0 && results.length === 0) return null;

  const renderMatchRow = (m: MatchSummary, isResult: boolean) => {
    const day = formatDayShort(m.scheduledAt, locale);
    const hour = formatKickoff(m.scheduledAt);

    return (
      <Pressable
        key={m.id}
        onPress={() => router.push(`/match/${m.id}`)}
        accessibilityRole="button"
        className="flex-row items-center border-b border-slate-100 px-3.5 py-2.5 active:bg-slate-50 dark:border-slate-800 dark:active:bg-slate-800/60"
      >
        {/* Fecha y hora */}
        <View className="w-[84px] pr-2">
          <Text numberOfLines={1} className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
            {day}
          </Text>
          <Text className="text-[10px] text-slate-400">
            {isResult ? (t('match_states.final') || 'Final') : hour}
          </Text>
        </View>

        {/* Equipos */}
        <View className="flex-1 min-w-0 pr-2">
          <View className="flex-row items-center gap-1.5 py-0.5">
            <Avatar uri={teamLogoUri(m.homeTeam.id, 48)} name={m.homeTeam.name} size={16} />
            <Text numberOfLines={1} className="flex-1 text-xs font-medium text-slate-900 dark:text-slate-100">
              {clubName(m.homeTeam.name) || m.homeTeam.shortName || m.homeTeam.name}
            </Text>
            {isResult && (
              <Text className="font-mono text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {m.score.home ?? 0}
              </Text>
            )}
          </View>
          <View className="flex-row items-center gap-1.5 py-0.5">
            <Avatar uri={teamLogoUri(m.awayTeam.id, 48)} name={m.awayTeam.name} size={16} />
            <Text numberOfLines={1} className="flex-1 text-xs font-medium text-slate-900 dark:text-slate-100">
              {clubName(m.awayTeam.name) || m.awayTeam.shortName || m.awayTeam.name}
            </Text>
            {isResult && (
              <Text className="font-mono text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {m.score.away ?? 0}
              </Text>
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View className="mb-4 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <View className="border-b border-slate-100 px-3.5 py-2.5 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/40">
        <Text className="text-[11px] font-bold uppercase tracking-wider text-rink-passion">
          {t('favorites.grada_title') || 'Mi grada'}
        </Text>
      </View>

      {/* Próximos partidos */}
      {upcoming.length > 0 && (
        <View>
          <View className="border-b border-slate-100 bg-slate-50/40 px-3.5 py-1.5 dark:border-slate-800 dark:bg-slate-800/20">
            <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {t('favorites.grada_upcoming') || 'Próximos partidos'}
            </Text>
          </View>
          {upcoming.map((m) => renderMatchRow(m, false))}
        </View>
      )}

      {/* Últimos resultados */}
      {results.length > 0 && (
        <View>
          <View className="border-b border-slate-100 bg-slate-50/40 px-3.5 py-1.5 dark:border-slate-800 dark:bg-slate-800/20">
            <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {t('favorites.grada_results') || 'Últimos resultados'}
            </Text>
          </View>
          {results.map((m) => renderMatchRow(m, true))}
        </View>
      )}
    </View>
  );
}
