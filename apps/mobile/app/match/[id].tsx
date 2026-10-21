import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Share, View } from 'react-native';
import { Stack, useIsFocused, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMatchDetail } from '@/src/hooks/queries';
import { useMatchLive } from '@/src/hooks/useMatchLive';
import { useInterstitialOnLeave } from '@/src/hooks/ads/useInterstitialOnLeave';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { BrandLoader } from '@/src/components/shared/BrandLoader';
import { AdBanner } from '@/src/components/ads/AdBanner';
import { MatchHeader } from '@/src/components/match/MatchHeader';
import { MatchTabs } from '@/src/components/match/MatchTabs';
import { TimelineTab } from '@/src/components/match/TimelineTab';
import { LineupsTab } from '@/src/components/match/LineupsTab';
import { StatsTab } from '@/src/components/match/StatsTab';
import { capture } from '@/src/lib/analytics';
import { isAdQuietTime } from '@/src/lib/time';
import { visibleTabsFor, type Tab } from '@/src/lib/match-helpers';
import { clubName } from '@/src/lib/names';

export default function MatchScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const matchId = Array.isArray(params.id) ? params.id[0] : params.id;
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

  if (!current) {
    return query.isError ? (
      <ErrorState onRetry={() => void query.refetch()} />
    ) : (
      <View className="flex-1 items-center justify-center bg-rink-floor dark:bg-rink-floor-dark">
        <BrandLoader />
      </View>
    );
  }

  const m = current.match;
  const isScheduled = m.status === 'scheduled' || m.status === 'postponed';
  const staleSeconds =
    live.stale && live.staleAt != null ? Math.max(0, Math.round((now - live.staleAt) / 1000)) : 0;

  const homeLabel = clubName(m.homeTeam.name) || m.homeTeam.shortName || m.homeTeam.name;
  const awayLabel = clubName(m.awayTeam.name) || m.awayTeam.shortName || m.awayTeam.name;
  const title = `${homeLabel} - ${awayLabel}`;

  const handleShare = () => {
    const scoreText =
      m.status === 'live' || m.status === 'finished'
        ? `${m.score.home ?? 0} - ${m.score.away ?? 0}`
        : 'vs';
    void Share.share({
      message: `${homeLabel} ${scoreText} ${awayLabel} | Stick Live\nhttps://sticklive.eu/matches/${m.id}`,
      url: `https://sticklive.eu/matches/${m.id}`,
      title: `${homeLabel} vs ${awayLabel}`,
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerBackTitle: 'Atrás',
          headerRight: () => (
            <Pressable
              onPress={handleShare}
              accessibilityLabel="Compartir partido"
              hitSlop={8}
              className="p-1 active:opacity-60"
            >
              <Ionicons name="share-outline" size={20} color="#0f172a" />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
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
        />

        {/* Pestañas de contenido */}
        <MatchTabs
          tabs={visibleTabs}
          activeTab={activeTab}
          onChange={setSelectedTab}
        />

        {/* Contenido de la pestaña activa */}
        {activeTab === 'Resumen' && (
          <TimelineTab
            events={current.events}
            homeTeamId={m.homeTeam.id}
            homeTeamName={m.homeTeam.shortName ?? m.homeTeam.name}
            awayTeamName={m.awayTeam.shortName ?? m.awayTeam.name}
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

        {/* Banner publicitario si está fuera de quiet time */}
        {!isAdQuietTime(m.status, m.scheduledAt) ? (
          <View className="mt-4">
            <AdBanner variant="match" />
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
