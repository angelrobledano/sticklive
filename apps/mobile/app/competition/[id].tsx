import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocale } from '@/src/i18n/LocaleContext';
import {
  useCompetitions,
  useCompetitionSeasons,
  useSeasonOverview,
  useSeasonStats,
} from '@/src/hooks/queries';
import { FollowButton } from '@/src/components/favorite/FollowButton';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { CompetitionDetailSkeleton } from '@/src/components/shared/Skeleton';
import { ShareHeaderButton } from '@/src/components/shared/ShareHeaderButton';
import { AdBanner } from '@/src/components/ads/AdBanner';
import { clubName } from '@/src/lib/names';
import {
  type MainTab,
  competitionTeamsForIndex,
  competitionVisibleTabs,
  knockoutTabLabelKey,
} from '@/src/lib/season-phases';
import { buildCompetitionSummary } from '@/src/lib/content-summary';
import { CompetitionSummary } from '@/src/components/competition/CompetitionSummary';
import { GameweeksTab } from '@/src/components/competition/GameweeksTab';
import { PlayoffsTab } from '@/src/components/competition/PlayoffsTab';
import { StatsLeadersTab } from '@/src/components/competition/StatsLeadersTab';
import { StandingsTable } from '@/src/components/competition/StandingsTable';
import type {
  SeasonOverviewStandingRow,
} from '@/src/lib/api/types';

export default function CompetitionScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; seasonId?: string }>();
  const competitionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { t } = useLocale();

  // Metadatos básicos de la competición
  const competitionsQuery = useCompetitions();
  const competitionMeta = useMemo(
    () => (competitionsQuery.data ?? []).find((c) => c.id === competitionId),
    [competitionsQuery.data, competitionId],
  );

  // Temporadas disponibles
  const seasonsQuery = useCompetitionSeasons(competitionId);
  const seasons = seasonsQuery.data?.seasons ?? [];

  // Temporada seleccionada
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(params.seasonId ?? null);
  const activeSeasonId =
    selectedSeasonId ??
    competitionMeta?.season?.id ??
    seasons.find((s) => s.isCurrent)?.id ??
    seasons[0]?.id;

  const overviewQuery = useSeasonOverview(activeSeasonId);
  const overview = overviewQuery.data;

  const statsQuery = useSeasonStats(activeSeasonId);
  const stats = statsQuery.data;

  // Resumen ("Así terminó" / "Así va la liga")
  const summary = useMemo(() => {
    if (!overview) return null;
    return buildCompetitionSummary(overview, stats);
  }, [overview, stats]);

  // Pestañas visibles en el orden correcto
  // Si playoffs han empezado o la liga ha finalizado, Playoffs se coloca primera
  // Si liga regular está en juego, Clasificación se coloca primera
  // Si torneo es Final Four, sólo Playoffs (sin Clasificación ni Jornadas)
  const visibleTabs = useMemo<MainTab[]>(() => {
    if (!overview) return ['Clasificación'];
    return competitionVisibleTabs(overview, stats, overview.season.competitionFormat);
  }, [overview, stats]);

  // Clave de texto para el tab de playoffs ('Playoffs' | 'Final Four' | 'Eliminatorias')
  const knockoutLabelKey = useMemo(() => {
    if (!overview) return 'match_tabs.playoffs';
    return knockoutTabLabelKey(
      overview.season.competitionFormat,
      overview.season.phases,
      overview.rounds,
      overview.matches,
    );
  }, [overview]);

  // Pestaña activa por defecto
  const [selectedTab, setSelectedTab] = useState<MainTab | null>(null);
  const activeTab: MainTab = useMemo(() => {
    if (selectedTab && visibleTabs.includes(selectedTab)) {
      return selectedTab;
    }
    return visibleTabs[0] ?? 'Clasificación';
  }, [selectedTab, visibleTabs]);

  // Equipos participantes para la sección final
  const participatingTeams = useMemo(() => {
    if (!overview) return [];
    return competitionTeamsForIndex(overview);
  }, [overview]);

  // Agrupación de clasificación por grupos (para torneos tipo Mundial o Champions con Grupo A/B)
  const standings = overview?.standings;
  const standingsByGroup = useMemo(() => {
    if (!standings || standings.length === 0) return [];
    const groupsMap = new Map<string, SeasonOverviewStandingRow[]>();
    for (const row of standings) {
      const grp = row.groupName ?? '';
      if (!groupsMap.has(grp)) groupsMap.set(grp, []);
      groupsMap.get(grp)!.push(row);
    }
    return [...groupsMap.entries()].map(([groupName, rows]) => ({
      groupName,
      rows: [...rows].sort(
        (a, b) =>
          (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
          b.points - a.points,
      ),
    }));
  }, [standings]);

  const compTitle =
    overview?.season.competitionName ??
    competitionMeta?.name ??
    t('search.section_competitions');

  const displayTitle = compTitle ? clubName(compTitle) || compTitle : '';

  const handleShare = () => {
    void Share.share({
      message: `${displayTitle} | Stick Live\nhttps://sticklive.eu/competitions/${competitionId}`,
      url: `https://sticklive.eu/competitions/${competitionId}`,
      title: displayTitle,
    });
  };

  const getTabLabel = (tab: MainTab) => {
    if (tab === 'Playoffs') {
      if (knockoutLabelKey === 'playoffs.final_four') {
        return t('playoffs.final_four') ?? 'Final Four';
      }
      if (knockoutLabelKey === 'match_tabs.knockout') {
        return t('match_tabs.knockout') ?? 'Eliminatorias';
      }
      return t('match_tabs.playoffs') ?? 'Playoffs';
    }
    if (tab === 'Clasificación') return t('match_tabs.standing') ?? 'Clasificación';
    if (tab === 'Jornadas') return t('match_tabs.fixtures') ?? 'Jornadas';
    if (tab === 'Estadísticas') return t('match_tabs.stats') ?? 'Estadísticas';
    return tab;
  };

  const headerElement = (
    <Stack.Screen
      options={{
        title: displayTitle,
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: displayTitle.length > 24 ? 15 : 17,
        },
        headerRight: () => (
          <ShareHeaderButton
            onPress={handleShare}
            accessibilityLabel="Compartir competición"
          />
        ),
      }}
    />
  );

  if (overviewQuery.isPending && !overview) {
    return (
      <>
        {headerElement}
        <CompetitionDetailSkeleton />
      </>
    );
  }

  if (overviewQuery.isError && !overview) {
    return (
      <>
        {headerElement}
        <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
          <ErrorState onRetry={() => void overviewQuery.refetch()} />
        </View>
      </>
    );
  }

  return (
    <>
      {headerElement}
      <ScrollView
        className="flex-1 bg-rink-floor dark:bg-rink-floor-dark"
        contentContainerStyle={{ paddingBottom: Math.max(40, insets.bottom + 16) }}
      >
        {/* Cabecera de competición */}
        <View className="mx-3 mt-2 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 flex-row items-center gap-3 pr-3">
              <Avatar
                uri={overview?.season.competitionLogoUrl ?? competitionMeta?.logoUrl}
                name={compTitle}
                size={46}
                variant="competition"
              />
              <View className="flex-1">
                <Text
                  className="text-xl font-bold text-slate-900 dark:text-slate-100"
                  numberOfLines={2}
                >
                  {compTitle}
                </Text>
                {overview?.season.name ? (
                  <Text className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {overview.season.name}
                  </Text>
                ) : null}
              </View>
            </View>
            {competitionId ? <FollowButton kind="league" refId={competitionId} name={compTitle} /> : null}
          </View>

          {/* Selector de temporada si hay varias */}
          {seasons.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3">
              <View className="flex-row gap-2">
                {seasons.map((s) => {
                  const isSelected = s.id === activeSeasonId;
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => setSelectedSeasonId(s.id)}
                      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={s.name}
                      className={`rounded-full px-3 py-1.5 ${
                        isSelected
                          ? 'bg-rink-passion dark:bg-rink-accent'
                          : 'bg-slate-100 dark:bg-slate-800'
                      }`}
                    >
                      <Text
                        className={`text-xs font-semibold ${
                          isSelected
                            ? 'text-white dark:text-slate-900'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {s.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          ) : null}
        </View>

        {/* Resumen ("Así terminó" / "Así va la liga") */}
        {summary ? <CompetitionSummary summary={summary} /> : null}

        {/* Selector de pestañas dinámicas */}
        {visibleTabs.length > 1 ? (
          <View className="mx-3 mt-3 flex-row rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800">
            {visibleTabs.map((tab) => {
              const isActive = activeTab === tab;
              return (
                <Pressable
                  key={tab}
                  onPress={() => setSelectedTab(tab)}
                  className={`flex-1 rounded-lg py-2 ${
                    isActive ? 'bg-white shadow-sm dark:bg-slate-900' : ''
                  }`}
                >
                  <Text
                    className={`text-center text-xs font-bold ${
                      isActive
                        ? 'text-slate-900 dark:text-slate-100'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {getTabLabel(tab)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* Contenido de la pestaña activa */}

        {/* PESTAÑA: PLAYOFFS / ELIMINATORIAS / FINAL FOUR */}
        {activeTab === 'Playoffs' && overview ? (
          <PlayoffsTab matches={overview.matches} />
        ) : null}

        {/* PESTAÑA: CLASIFICACIÓN */}
        {activeTab === 'Clasificación' ? (
          <View className="px-3 pt-3">
            {standingsByGroup.length === 0 ? (
              <EmptyState title={t('standings.no_data') ?? 'No hay datos de clasificación'} />
            ) : (
              standingsByGroup.map(({ groupName, rows }) => (
                <View key={groupName || 'sin-grupo'}>
                  {groupName ? (
                    <View className="mb-1.5 px-1">
                      <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        {groupName}
                      </Text>
                    </View>
                  ) : null}
                  <StandingsTable rows={rows} legacyZones={!groupName} />
                </View>
              ))
            )}
          </View>
        ) : null}

        {/* PESTAÑA: JORNADAS */}
        {activeTab === 'Jornadas' && overview ? (
          <GameweeksTab rounds={overview.rounds} matches={overview.matches} />
        ) : null}

        {/* PESTAÑA: ESTADÍSTICAS */}
        {activeTab === 'Estadísticas' ? (
          <StatsLeadersTab stats={stats} />
        ) : null}

        {/* Sección: EQUIPOS PARTICIPANTES */}
        {participatingTeams.length > 0 ? (
          <View className="mx-3 mt-6">
            <View className="mb-3 flex-row items-center justify-between">
              <View className="flex-row items-center gap-1.5">
                <Ionicons name="shield-outline" size={14} color="#64748b" />
                <Text className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Equipos
                </Text>
              </View>
              <Text className="text-xs font-semibold text-slate-400">
                {participatingTeams.length}
              </Text>
            </View>

            <View className="flex-row flex-wrap gap-2">
              {participatingTeams.map((team) => (
                <Pressable
                  key={team.id}
                  onPress={() => router.push(`/team/${team.id}`)}
                  className="w-[48.5%] flex-row items-center gap-2 rounded-xl border border-slate-100 bg-white p-2.5 shadow-xs active:opacity-75 dark:border-slate-800 dark:bg-slate-900"
                >
                  <Avatar uri={teamLogoUri(team.id, 64)} name={team.name} size={28} />
                  <Text
                    numberOfLines={2}
                    className="flex-1 text-xs font-semibold text-slate-800 dark:text-slate-200"
                  >
                    {clubName(team.name) || team.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View className="mt-4">
          <AdBanner variant="list" />
        </View>
      </ScrollView>
    </>
  );
}
