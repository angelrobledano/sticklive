import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, RefreshControl, ScrollView, View } from 'react-native';
import { Stack, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMatchDetail, useSeasonOverview, useTeam } from '@/src/hooks/queries';
import { useMatchLive } from '@/src/hooks/useMatchLive';
import { useInterstitialOnLeave } from '@/src/hooks/ads/useInterstitialOnLeave';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { MatchDetailSkeleton } from '@/src/components/shared/Skeleton';
import { ShareHeaderButton } from '@/src/components/shared/ShareHeaderButton';
import { ShareImageModal } from '@/src/components/shared/ShareImageModal';
import { AdBanner } from '@/src/components/ads/AdBanner';
import { MatchHeader } from '@/src/components/match/MatchHeader';
import { MatchTabs } from '@/src/components/match/MatchTabs';
import { TimelineTab } from '@/src/components/match/TimelineTab';
import { LineupsTab } from '@/src/components/match/LineupsTab';
import { StatsTab } from '@/src/components/match/StatsTab';
import { MatchPreview } from '@/src/components/match/MatchPreview';
import { capture } from '@/src/lib/analytics';
import { isAdQuietTime } from '@/src/lib/time';
import { visibleTabsFor, type Tab } from '@/src/lib/match-helpers';
import { buildMatchPreview } from '@sports/core/content-summary';
import { clubName } from '@sports/core/names';
import { useLocale } from '@/src/i18n/LocaleContext';

export default function MatchScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const matchId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { locale } = useLocale();
  const query = useMatchDetail(matchId ?? '');
  const live = useMatchLive(matchId ?? '', undefined);

  // Analítica (Task 5.1): apertura de la ficha, una vez por matchId
  useEffect(() => {
    if (matchId) capture('match_opened', { match_id: matchId });
  }, [matchId]);

  // Reloj del desfase
  const [now, setNow] = useState(() => Date.now());
  const focused = useIsFocused();
  useEffect(() => {
    if (!live.stale || !focused) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live.stale, focused]);

  const current = live.detail ?? query.data;

  // Interstitial al SALIR de una ficha NO en vivo
  useInterstitialOnLeave(current?.match.status, current?.match.scheduledAt);

  // Pestañas visibles y activa (derivada, sin setState en effect)
  const visibleTabs = useMemo(() => (current ? visibleTabsFor(current) : []), [current]);
  const [selectedTab, setSelectedTab] = useState<Tab>('Resumen');
  const activeTab = visibleTabs.includes(selectedTab) ? selectedTab : (visibleTabs[0] ?? 'Resumen');

  const rawMatch = current?.match;
  const homeLabel = rawMatch ? clubName(rawMatch.homeTeam.name) || rawMatch.homeTeam.shortName || rawMatch.homeTeam.name : '';
  const awayLabel = rawMatch ? clubName(rawMatch.awayTeam.name) || rawMatch.awayTeam.shortName || rawMatch.awayTeam.name : '';
  const title = rawMatch ? `${homeLabel} - ${awayLabel}` : '';

  const seasonOverviewQuery = useSeasonOverview(rawMatch?.seasonId);
  const homeTeamQuery = useTeam(rawMatch?.homeTeam.id ?? '', rawMatch?.seasonId);
  const awayTeamQuery = useTeam(rawMatch?.awayTeam.id ?? '', rawMatch?.seasonId);
  const [shareImageModalOpen, setShareImageModalOpen] = useState(false);

  const preview = useMemo(() => {
    if (!rawMatch || !seasonOverviewQuery.data || !rawMatch.homeTeam.id || !rawMatch.awayTeam.id) {
      return null;
    }
    try {
      return buildMatchPreview(
        seasonOverviewQuery.data,
        {
          matchId: rawMatch.id,
          homeTeamId: rawMatch.homeTeam.id,
          awayTeamId: rawMatch.awayTeam.id,
          homeName: homeLabel,
          awayName: awayLabel,
        },
        {
          homeStats: homeTeamQuery.data?.stats,
          awayStats: awayTeamQuery.data?.stats,
        },
      );
    } catch {
      return null;
    }
  }, [
    rawMatch,
    seasonOverviewQuery.data,
    homeTeamQuery.data,
    awayTeamQuery.data,
    homeLabel,
    awayLabel,
  ]);

  const handleShare = () => {
    if (!rawMatch) return;
    setShareImageModalOpen(true);
  };

  const headerElement = (
    <Stack.Screen
      options={{
        title,
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: title.length > 24 ? 15 : 17,
        },
        headerBackTitle: 'Atrás',
        headerRight: () =>
          title ? (
            <ShareHeaderButton
              onPress={handleShare}
              accessibilityLabel="Compartir partido"
            />
          ) : null,
      }}
    />
  );

  if (!current) {
    return (
      <>
        {headerElement}
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <MatchDetailSkeleton />
        )}
      </>
    );
  }

  const m = current.match;
  const isScheduled = m.status === 'scheduled' || m.status === 'postponed';
  const staleSeconds =
    live.stale && live.staleAt != null ? Math.max(0, Math.round((now - live.staleAt) / 1000)) : 0;

  return (
    <>
      {headerElement}
      <ScrollView
        contentContainerStyle={{ paddingBottom: Math.max(32, insets.bottom + 16) }}
        className="flex-1 bg-rink-floor dark:bg-rink-floor-dark"
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
          />
        }
      >
        {/* Cabecera rica del partido con marcador, escudos y faltas */}
        <MatchHeader
          data={current}
          liveStale={live.stale}
          staleSeconds={staleSeconds}
          connected={live.connected}
          transport={live.transport}
          onReconnect={live.reconnect}
        />

        {/* Previa visual destacada en partidos programados */}
        {isScheduled && preview ? <MatchPreview data={preview} locale={locale} /> : null}

        {/* Pestañas de contenido */}
        <MatchTabs
          tabs={visibleTabs}
          activeTab={activeTab}
          onChange={setSelectedTab}
        />

        {/* Contenido de la pestaña activa con transición suave */}
        <AnimatedTabContent activeKey={activeTab}>
          {activeTab === 'Resumen' && (
            <TimelineTab
              events={current.events}
              homeTeamId={m.homeTeam.id}
              homeTeamName={homeLabel}
              awayTeamName={awayLabel}
              isScheduled={isScheduled}
            />
          )}

          {activeTab === 'Alineaciones' && (
            <LineupsTab
              lineups={current.lineups}
              homeTeam={m.homeTeam}
              awayTeam={m.awayTeam}
            />
          )}

          {activeTab === 'Estadísticas' && <StatsTab data={current} />}
        </AnimatedTabContent>

        {/* En directo/finalizado la previa y balance H2H van al final */}
        {!isScheduled && preview ? <MatchPreview data={preview} locale={locale} /> : null}

        {/* Banner publicitario si está fuera de quiet time */}
        {!isAdQuietTime(m.status, m.scheduledAt) ? (
          <View className="mt-4">
            <AdBanner variant="match" />
          </View>
        ) : null}
      </ScrollView>

      {rawMatch ? (
        <ShareImageModal
          visible={shareImageModalOpen}
          onClose={() => setShareImageModalOpen(false)}
          imagePath={`/matches/${rawMatch.id}/share-image`}
          name={`${homeLabel} vs ${awayLabel}`}
          kind="match"
        />
      ) : null}
    </>
  );
}

/** Contenedor con transición fluida de opacidad y desplazamiento sutil entre pestañas. */
function AnimatedTabContent({
  activeKey,
  children,
}: {
  activeKey: string;
  children: React.ReactNode;
}) {
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [activeKey, anim]);

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [
          {
            translateY: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [6, 0],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}
