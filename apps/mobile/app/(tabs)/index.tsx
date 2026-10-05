import { useMemo } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useCurrentMatches } from '@/src/hooks/queries';
import { MatchCard } from '@/src/components/match/MatchCard';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { formatDayLabel, isEffectivelyLive } from '@/src/lib/time';
import type { MatchSummary } from '@/src/lib/api/types';

interface Section {
  key: string;
  title: string;
  matches: MatchSummary[];
}

export default function LiveScreen() {
  const { data, isPending, isError, refetch, isRefetching } = useCurrentMatches();
  const { t } = useLocale();

  const sections = useMemo<Section[]>(() => {
    const list = data ?? [];
    const live = list.filter((m) => isEffectivelyLive(m.status, m.scheduledAt));
    const byDay = new Map<string, MatchSummary[]>();
    for (const m of list.filter((x) => !isEffectivelyLive(x.status, x.scheduledAt))) {
      const key = formatDayLabel(m.scheduledAt) || '—';
      (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(m);
    }
    return [
      ...(live.length ? [{ key: '__live__', title: t('match_states.live'), matches: live }] : []),
      ...[...byDay.entries()].map(([key, matches]) => ({ key, title: key, matches })),
    ];
  }, [data, t]);

  if (isPending) return <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark" />;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <FlatList
      className="bg-rink-floor dark:bg-rink-floor-dark"
      data={sections}
      keyExtractor={(s) => s.key}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      renderItem={({ item }) => (
        <View>
          <Text className="px-4 pb-1 pt-3 text-xs font-bold uppercase text-slate-500">{item.title}</Text>
          {item.matches.map((m) => <MatchCard key={m.id} match={m} />)}
        </View>
      )}
      ListEmptyComponent={
        <EmptyState title={t('common.no_matches_today')} hint={t('common.no_matches_hint')} />
      }
    />
  );
}
