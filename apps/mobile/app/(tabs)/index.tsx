import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useAdsConfig, useCurrentMatches } from '@/src/hooks/queries';
import { useSession } from '@/src/context/AuthContext';
import { useFavorites, useLocalFavorites } from '@/src/hooks/favorites';
import { MatchGroupCard } from '@/src/components/home/MatchGroupCard';
import { MatchRow } from '@/src/components/home/MatchRow';
import { DateSelector } from '@/src/components/home/DateSelector';
import { DayChips } from '@/src/components/home/DayChips';
import { AdBanner } from '@/src/components/ads/AdBanner';
import { NativeFeedAd } from '@/src/components/ads/NativeFeedAd';
import { insertNativeAdPositions } from '@/src/lib/ads/nativeFeed';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { BrandLoader } from '@/src/components/shared/BrandLoader';
import { BrandHeaderTitle, HomeHeaderRight } from '@/src/components/layout/AppHeader';
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
  competitionId?: string | null;
  followed?: boolean;
  matches: MatchSummary[];
}

type FeedItem =
  | { kind: 'group'; key: string; section: Section }
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
  const navigation = useNavigation();

  // Analítica: vista de la pestaña home
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

  // Cabecera interactiva y de marca (STICK LIVE + Hoy + Live Badge + Búsqueda)
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <BrandHeaderTitle
          onPress={() => {
            setSelectedDate(todayKey);
            setFilter('all');
          }}
        />
      ),
      headerTitleAlign: 'left',
      headerRight: () => (
        <HomeHeaderRight
          selectedDate={selectedDate}
          todayKey={todayKey}
          onResetToday={() => {
            setSelectedDate(todayKey);
            setFilter('all');
          }}
          liveCount={dayView.liveCount}
          isLiveFilterActive={dayView.filter === 'live'}
          onToggleLive={() => setFilter(filter === 'live' ? 'all' : 'live')}
        />
      ),
    });
  }, [navigation, selectedDate, todayKey, dayView.liveCount, dayView.filter, filter]);

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
        title: t('favorites.following_section') || 'Siguiendo',
        competitionId: null,
        followed: true,
        matches: dayView.myTeams,
      });
    }
    for (const comp of dayView.competitions) {
      list.push({
        key: comp.key,
        title: comp.name ?? 'Otras competiciones',
        competitionId: comp.id,
        followed: comp.followed,
        matches: comp.matches,
      });
    }
    return list;
  }, [dayView, t]);

  // Native in-feed: intercalados tras el grupo correspondiente
  const everyNItems =
    adsConfig?.nativeFeed.enabled === true ? adsConfig.nativeFeed.everyNItems : undefined;

  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = sections.map((s) => ({
      kind: 'group',
      key: `group:${s.key}`,
      section: s,
    }));
    const [position] = insertNativeAdPositions(items.length, everyNItems);
    if (position === undefined) return items;
    const out = [...items];
    out.splice(position, 0, { kind: 'ad', key: 'native-ad' });
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
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
        data={feed}
        keyExtractor={(item) => item.key}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
        renderItem={({ item }) => {
          if (item.kind === 'ad') return <NativeFeedAd />;
          const { section } = item;
          return (
            <MatchGroupCard
              key={section.key}
              title={section.title}
              competitionId={section.competitionId}
              count={section.matches.length}
              followed={section.followed}
            >
              {section.matches.map((m) => (
                <MatchRow
                  key={m.id}
                  match={m}
                  showCompetition={section.key === '__following__'}
                />
              ))}
            </MatchGroupCard>
          );
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
                className="mt-4 rounded-xl bg-rink-passion px-5 py-2.5 active:opacity-80 dark:bg-rose-700"
              >
                <Text className="text-sm font-semibold text-white">
                  Ver próxima jornada: {formatDayLabel(next.dayKey)}
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
