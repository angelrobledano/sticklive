import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useAdsConfig, useCurrentMatches } from '@/src/hooks/queries';
import { useSession } from '@/src/context/AuthContext';
import { useFavorites, useLocalFavorites } from '@/src/hooks/favorites';
import { MatchCard } from '@/src/components/match/MatchCard';
import { DateSelector } from '@/src/components/home/DateSelector';
import { DayChips } from '@/src/components/home/DayChips';
import { AdBanner } from '@/src/components/ads/AdBanner';
import { NativeFeedAd } from '@/src/components/ads/NativeFeedAd';
import { insertNativeAdPositions } from '@/src/lib/ads/nativeFeed';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { BrandLoader } from '@/src/components/shared/BrandLoader';
import { capture } from '@/src/lib/analytics';
import { formatDayLabel } from '@/src/lib/time';
import {
  buildDayView,
  daysWithMatches,
  madridTodayKey,
  nextMatchday,
  type DayFilter,
} from '@/src/lib/day-view';
import type { MatchSummary } from '@/src/lib/api/types';

interface Section {
  key: string;
  title: string;
  matches: MatchSummary[];
}

type FeedItem =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'match'; key: string; match: MatchSummary }
  | { kind: 'ad'; key: string };

export default function LiveScreen() {
  const { data, isPending, isError, refetch, isRefetching } = useCurrentMatches();
  const { data: adsConfig } = useAdsConfig();
  const { t, locale } = useLocale();

  // Favoritos del usuario (con o sin sesión) para destacar partidos en "Siguiendo"
  const { session } = useSession();
  const token = session?.token;
  const local = useLocalFavorites(!token);
  const server = useFavorites(token);
  const favData = token ? server.data : local.data;
  const teamIds = useMemo(() => favData?.teams ?? [], [favData?.teams]);
  const leagueIds = useMemo(() => favData?.leagues ?? [], [favData?.leagues]);

  const todayKey = madridTodayKey();
  const [selectedDate, setSelectedDate] = useState<string>(todayKey);
  const [filter, setFilter] = useState<DayFilter>('all');

  // Analítica (Task 5.1): vista de la pestaña home
  useEffect(() => {
    capture('live_tab_viewed');
  }, []);

  const markedDays = useMemo(() => daysWithMatches(data ?? []), [data]);

  const dayView = useMemo(
    () =>
      buildDayView(data ?? [], {
        dayKey: selectedDate,
        teamIds,
        leagueIds,
        filter,
        locale,
      }),
    [data, selectedDate, teamIds, leagueIds, filter, locale],
  );

  const next = useMemo(
    () =>
      dayView.total === 0 && selectedDate >= todayKey
        ? nextMatchday(data ?? [], selectedDate, { teamIds, leagueIds, locale })
        : null,
    [dayView.total, selectedDate, todayKey, data, teamIds, leagueIds, locale],
  );

  const sections = useMemo<Section[]>(() => {
    const list: Section[] = [];
    if (dayView.myTeams.length > 0) {
      list.push({
        key: '__following__',
        title: 'Siguiendo',
        matches: dayView.myTeams,
      });
    }
    for (const comp of dayView.competitions) {
      list.push({
        key: comp.key,
        title: comp.name ?? 'Otras competiciones',
        matches: comp.matches,
      });
    }
    return list;
  }, [dayView]);

  // Native in-feed (Plan D Task 6): items sintéticos intercalados cada N partidos
  const everyNItems =
    adsConfig?.nativeFeed.enabled === true ? adsConfig.nativeFeed.everyNItems : undefined;

  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    for (const s of sections) {
      items.push({ kind: 'header', key: `header:${s.key}`, title: s.title });
      for (const m of s.matches) items.push({ kind: 'match', key: `match:${m.id}`, match: m });
    }
    const matchCount = items.reduce((n, it) => (it.kind === 'match' ? n + 1 : n), 0);
    const [position] = insertNativeAdPositions(matchCount, everyNItems);
    if (position === undefined) return items;
    const out: FeedItem[] = [];
    let seen = 0;
    for (const it of items) {
      out.push(it);
      if (it.kind === 'match' && ++seen === position) out.push({ kind: 'ad', key: 'native-ad' });
    }
    return out;
  }, [sections, everyNItems]);

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-rink-floor dark:bg-rink-floor-dark">
        <BrandLoader />
      </View>
    );
  }

  if (isError && !data) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
      {/* Selector de fecha horizontal (carrusel días ±) */}
      <DateSelector
        selected={selectedDate}
        onSelect={(key) => {
          setSelectedDate(key);
          setFilter('all');
        }}
        markedDays={markedDays}
      />

      {/* Filtros de jornada (En directo / Siguiendo) */}
      <DayChips
        liveCount={dayView.liveCount}
        followingCount={dayView.followingCount}
        filter={dayView.filter}
        onChange={setFilter}
      />

      {/* Lista de partidos de la jornada agrupados por competición */}
      <FlatList
        contentContainerStyle={{ flexGrow: 1 }}
        data={feed}
        keyExtractor={(item) => item.key}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return (
              <Text className="px-4 pb-1 pt-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                {item.title}
              </Text>
            );
          }
          if (item.kind === 'ad') return <NativeFeedAd />;
          return <MatchCard match={item.match} />;
        }}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center px-8 py-16">
            <EmptyState
              title={
                selectedDate === todayKey
                  ? t('common.no_matches_today')
                  : t('common.no_matches_this_day')
              }
              hint={t('common.no_matches_hint')}
            />
            {next ? (
              <Pressable
                onPress={() => setSelectedDate(next.dayKey)}
                className="mt-4 rounded-xl bg-rink-passion px-4 py-2.5 active:opacity-80 dark:bg-rose-700"
              >
                <Text className="text-sm font-semibold text-white">
                  Ver jornada: {formatDayLabel(next.dayKey)}
                </Text>
              </Pressable>
            ) : null}
          </View>
        }
        ListFooterComponent={<AdBanner variant="list" />}
      />
    </View>
  );
}
