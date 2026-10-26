import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, PanResponder, Pressable, RefreshControl, Text, useWindowDimensions, View } from 'react-native';
import { useNavigation } from 'expo-router';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useAdsConfig, useDayMatches, useFeedMatches } from '@/src/hooks/queries';
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
import { FeedSkeleton } from '@/src/components/shared/Skeleton';
import { BrandHeaderTitle, HomeHeaderRight } from '@/src/components/layout/AppHeader';
import { capture } from '@/src/lib/analytics';
import { formatDayLabel, isEffectivelyLive } from '@/src/lib/time';
import {
  addDaysToKey,
  buildDayView,
  hiddenForDay,
  daysWithMatches,
  defaultOpenKeys,
  extractGestureStartX,
  isHorizontalSwipeGesture,
  isOutsideEdgeGuard,
  madridTodayKey,
  nextMatchday,
  resolveDaySwipeDelta,
  type DayFilter,
} from '@/src/lib/day-view';
import { usePreferredCountry } from '@/src/hooks/usePreferredCountry';
import { deviceTimeZone } from '@/src/lib/viewer-tz';
import type { MatchSummary } from '@/src/lib/api/types';

interface Section {
  key: string;
  title: string;
  competitionId?: string | null;
  logoUrl?: string | null;
  country?: string | null;
  liveCount: number;
  followed?: boolean;
  matches: MatchSummary[];
}

type FeedItem =
  | { kind: 'group'; key: string; section: Section }
  | { kind: 'ad'; key: string };

export default function LiveScreen() {
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

  // Visibilidad (spec 2026-10-30): la home pide solo destacadas + lo seguido.
  // «Otras competiciones» del día se piden bajo demanda.
  const feedQuery = useFeedMatches({ teams: teamIds, leagues: leagueIds });
  const { isPending, isError, refetch, isRefetching } = feedQuery;

  const todayKey = madridTodayKey();
  const [selectedDate, setSelectedDate] = useState<string>(todayKey);
  const [filter, setFilter] = useState<DayFilter>('all');
  const [othersDay, setOthersDay] = useState<string | null>(null);
  const othersOpen = othersDay === selectedDate;
  const dayAll = useDayMatches(selectedDate, othersOpen);
  const data = useMemo(() => {
    const feed = feedQuery.data?.matches ?? [];
    if (!othersOpen || !dayAll.data) return feed;
    const seen = new Set(feed.map((m) => m.id));
    return [...feed, ...dayAll.data.filter((m) => !seen.has(m.id))];
  }, [feedQuery.data, othersOpen, dayAll.data]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const navigation = useNavigation();

  const { country: preferredCountry } = usePreferredCountry();
  const viewerTz = useMemo(() => deviceTimeZone(), []);

  // Analítica: vista de la pestaña home
  useEffect(() => {
    capture('live_tab_viewed');
  }, []);

  const markedDays = useMemo(() => daysWithMatches(data ?? [], viewerTz), [data, viewerTz]);

  const dayView = useMemo(
    () =>
      buildDayView(data ?? [], {
        dayKey: selectedDate,
        teamIds,
        leagueIds,
        filter,
        locale,
        includeOthers: othersOpen,
        tz: viewerTz,
        country: preferredCountry,
      }),
    [data, selectedDate, teamIds, leagueIds, filter, locale, othersOpen, viewerTz, preferredCountry],
  );

  const defaultOpen = useMemo(
    () => defaultOpenKeys(dayView.competitions, preferredCountry),
    [dayView.competitions, preferredCountry],
  );
  const othersCount = othersOpen ? 0 : hiddenForDay(feedQuery.data?.hiddenByHour, selectedDate);

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
        />
      ),
    });
  }, [navigation, selectedDate, todayKey]);

  const next = useMemo(
    () =>
      dayView.total === 0 && selectedDate >= todayKey
        ? nextMatchday(data ?? [], selectedDate, {
            teamIds,
            leagueIds,
            locale,
            tz: viewerTz,
            country: preferredCountry,
          })
        : null,
    [dayView.total, selectedDate, todayKey, data, teamIds, leagueIds, locale, viewerTz, preferredCountry],
  );

  const sections = useMemo<Section[]>(() => {
    const list: Section[] = [];
    if (dayView.myTeams.length > 0) {
      list.push({
        key: '__following__',
        title: t('favorites.following_section') || 'Siguiendo',
        competitionId: null,
        logoUrl: null,
        country: null,
        liveCount: dayView.myTeams.filter((m) => isEffectivelyLive(m.status, m.scheduledAt)).length,
        followed: true,
        matches: dayView.myTeams,
      });
    }
    for (const comp of dayView.competitions) {
      list.push({
        key: comp.key,
        title: comp.name ?? 'Otras competiciones',
        competitionId: comp.id,
        logoUrl: comp.logoUrl,
        country: comp.country,
        liveCount: comp.matches.filter((m) => isEffectivelyLive(m.status, m.scheduledAt)).length,
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

  const { width: screenWidth } = useWindowDimensions();

  // Gestos táctiles de deslizamiento horizontal para cambiar de día
  // Se protegen 32dp en ambos bordes laterales para no interferir con el gesto
  // nativo Atrás de Android 15 (Predictive Back Gesture).
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (evt, gestureState) => {
          const startX = extractGestureStartX(evt, gestureState);
          return (
            isOutsideEdgeGuard(startX, screenWidth) &&
            isHorizontalSwipeGesture(gestureState.dx, gestureState.dy)
          );
        },
        onMoveShouldSetPanResponderCapture: (evt, gestureState) => {
          const startX = extractGestureStartX(evt, gestureState);
          return (
            isOutsideEdgeGuard(startX, screenWidth) &&
            isHorizontalSwipeGesture(gestureState.dx, gestureState.dy)
          );
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_, gestureState) => {
          const delta = resolveDaySwipeDelta(gestureState.dx, gestureState.vx);
          if (delta !== 0) {
            setSelectedDate((prev) => addDaysToKey(prev, delta));
            setFilter('all');
            setOverrides({});
          }
        },
      }),
    [screenWidth],
  );

  if (isPending) {
    return <FeedSkeleton />;
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
          setOverrides({});
        }}
        markedDays={markedDays}
      />

      {/* Contenedor del feed con soporte para deslizar horizontalmente y cambiar de día */}
      <View className="flex-1" {...panResponder.panHandlers}>
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
            const isFollowingSection = section.key === '__following__';
            const isOpen = isFollowingSection
              ? true
              : (overrides[section.key] ?? defaultOpen.has(section.key));

            return (
              <MatchGroupCard
                key={section.key}
                title={section.title}
                competitionId={section.competitionId}
                logoUrl={section.logoUrl}
                country={section.country}
                count={section.matches.length}
                liveCount={section.liveCount}
                followed={section.followed}
                isOpen={isOpen}
                onToggleOpen={() => {
                  setOverrides((prev) => {
                    const current = prev[section.key] ?? defaultOpen.has(section.key);
                    return { ...prev, [section.key]: !current };
                  });
                }}
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
                  othersCount > 0
                    ? t('home.no_featured_matches')
                    : selectedDate === todayKey
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
                    {t('home.next_matchday').replace('{day}', formatDayLabel(next.dayKey, locale))}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          }
          ListFooterComponent={
            <View>
              {othersOpen || othersCount > 0 ? (
                <Pressable
                  onPress={() => setOthersDay(othersOpen ? null : selectedDate)}
                  disabled={othersOpen && dayAll.isFetching}
                  className="mx-3 mt-3 min-h-[44px] items-center justify-center rounded-xl border border-dashed border-slate-300 px-4 active:opacity-70 dark:border-slate-700"
                >
                  <Text className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">
                    {othersOpen
                      ? t('home.others_hide')
                      : t('home.others_show').replace('{n}', String(othersCount))}
                  </Text>
                </Pressable>
              ) : null}
              <AdBanner variant="list" />
            </View>
          }
        />
      </View>
    </View>
  );
}
