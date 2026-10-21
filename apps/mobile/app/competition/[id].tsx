import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useCompetitions, useCompetitionSeasons, useSeasonOverview } from '@/src/hooks/queries';
import { FollowButton } from '@/src/components/favorite/FollowButton';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { BrandLoader } from '@/src/components/shared/BrandLoader';
import { AdBanner } from '@/src/components/ads/AdBanner';
import { formatDayLabel, formatKickoff, isEffectivelyLive } from '@/src/lib/time';
import { clubName } from '@/src/lib/names';
import type { SeasonOverviewMatch, SeasonOverviewStandingRow } from '@/src/lib/api/types';

const COL_WIDTHS = 'w-7' as const;

export default function CompetitionScreen() {
  const params = useLocalSearchParams<{ id: string; seasonId?: string }>();
  const competitionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { t } = useLocale();

  // Buscar metadatos básicos de la competición en la lista en caché o fetch
  const competitionsQuery = useCompetitions();
  const competitionMeta = useMemo(
    () => (competitionsQuery.data ?? []).find((c) => c.id === competitionId),
    [competitionsQuery.data, competitionId],
  );

  // Obtener temporadas disponibles
  const seasonsQuery = useCompetitionSeasons(competitionId);
  const seasons = seasonsQuery.data?.seasons ?? [];

  // Temporada seleccionada: query param > temporada activa de metadatos > primera del histórico
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(params.seasonId ?? null);
  const activeSeasonId =
    selectedSeasonId ??
    competitionMeta?.season?.id ??
    seasons.find((s) => s.isCurrent)?.id ??
    seasons[0]?.id;

  const overviewQuery = useSeasonOverview(activeSeasonId);
  const overview = overviewQuery.data;

  // Pestaña activa: 'standings' | 'calendar'
  const [activeTab, setActiveTab] = useState<'standings' | 'calendar'>('standings');

  // Filtro de jornada/ronda en calendario (opcional)
  const [selectedRound, setSelectedRound] = useState<number | null>(null);

  const overviewRounds = overview?.rounds;
  const rounds = useMemo(() => {
    if (!overviewRounds) return [];
    return [...overviewRounds].sort((a, b) => a.number - b.number);
  }, [overviewRounds]);

  const overviewMatches = overview?.matches;
  const matchesByRound = useMemo(() => {
    if (!overviewMatches) return [];
    if (selectedRound === null) return overviewMatches;
    return overviewMatches.filter((m) => m.roundNumber === selectedRound);
  }, [overviewMatches, selectedRound]);

  const compTitle =
    overview?.season.competitionName ??
    competitionMeta?.name ??
    t('search.section_competitions');

  if (overviewQuery.isPending && !overview) {
    return (
      <View className="flex-1 items-center justify-center bg-rink-floor dark:bg-rink-floor-dark">
        <BrandLoader />
      </View>
    );
  }

  if (overviewQuery.isError && !overview) {
    return (
      <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
        <ErrorState onRetry={() => void overviewQuery.refetch()} />
      </View>
    );
  }

  const displayTitle = clubName(compTitle) || compTitle;

  const handleShare = () => {
    void Share.share({
      message: `${displayTitle} | Stick Live\nhttps://sticklive.eu/competitions/${competitionId}`,
      url: `https://sticklive.eu/competitions/${competitionId}`,
      title: displayTitle,
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: displayTitle,
          headerRight: () => (
            <Pressable
              onPress={handleShare}
              accessibilityLabel="Compartir competición"
              hitSlop={8}
              className="p-1 active:opacity-60"
            >
              <Ionicons name="share-outline" size={20} color="#0f172a" />
            </Pressable>
          ),
        }}
      />
      <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
        {/* Cabecera de competición */}
        <View className="mx-3 mt-2 rounded-xl bg-white p-4 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3 flex-1 pr-3">
              <Avatar
                uri={overview?.season.competitionLogoUrl ?? competitionMeta?.logoUrl}
                name={compTitle}
                size={44}
                variant="competition"
              />
              <View className="flex-1">
                <Text className="text-xl font-bold text-slate-900 dark:text-slate-100" numberOfLines={2}>
                  {compTitle}
                </Text>
                {overview?.season.name ? (
                  <Text className="text-xs text-slate-500">{overview.season.name}</Text>
                ) : null}
              </View>
            </View>
            {competitionId ? <FollowButton kind="league" refId={competitionId} /> : null}
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
                      className={`rounded-full px-3 py-1 ${
                        isSelected
                          ? 'bg-rink-passion dark:bg-accent'
                          : 'bg-slate-100 dark:bg-slate-800'
                      }`}
                    >
                      <Text
                        className={`text-xs font-semibold ${
                          isSelected ? 'text-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-300'
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

          {/* Tabs: Clasificación vs Calendario */}
          <View className="mt-4 flex-row rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            <Pressable
              onPress={() => setActiveTab('standings')}
              className={`flex-1 rounded-md py-1.5 ${
                activeTab === 'standings' ? 'bg-white shadow-sm dark:bg-slate-900' : ''
              }`}
            >
              <Text
                className={`text-center text-sm font-semibold ${
                  activeTab === 'standings'
                    ? 'text-slate-900 dark:text-slate-100'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {t('nav.standings')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab('calendar')}
              className={`flex-1 rounded-md py-1.5 ${
                activeTab === 'calendar' ? 'bg-white shadow-sm dark:bg-slate-900' : ''
              }`}
            >
              <Text
                className={`text-center text-sm font-semibold ${
                  activeTab === 'calendar'
                    ? 'text-slate-900 dark:text-slate-100'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {t('team.calendar')}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Contenido de la pestaña */}
        {activeTab === 'standings' ? (
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            {!overview?.standings || overview.standings.length === 0 ? (
              <EmptyState title={t('standings.no_data')} />
            ) : (
              <View className="mx-3 mt-3 overflow-hidden rounded-xl bg-white dark:bg-slate-900">
                {/* Cabecera tabla */}
                <View className="flex-row items-center border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-500 dark:border-slate-800">
                  <Text className="w-6 text-center text-xs font-bold text-slate-500">#</Text>
                  <Text className="flex-1 text-xs font-bold uppercase text-slate-500">{t('standings.team')}</Text>
                  <Text className={`${COL_WIDTHS} text-center text-xs font-bold text-slate-500`}>{t('standings.cols.played')}</Text>
                  <Text className={`${COL_WIDTHS} text-center text-xs font-bold text-slate-500`}>{t('standings.cols.won')}</Text>
                  <Text className={`${COL_WIDTHS} text-center text-xs font-bold text-slate-500`}>{t('standings.cols.drawn')}</Text>
                  <Text className={`${COL_WIDTHS} text-center text-xs font-bold text-slate-500`}>{t('standings.cols.lost')}</Text>
                  <Text className={`${COL_WIDTHS} text-center text-xs font-bold text-slate-900 dark:text-slate-100`}>
                    {t('standings.cols.pts')}
                  </Text>
                </View>
                {/* Filas */}
                {overview.standings.map((row: SeasonOverviewStandingRow) => (
                  <Pressable
                    key={row.id}
                    onPress={() => router.push(`/team/${row.teamId}`)}
                    className="flex-row items-center border-b border-slate-100 px-3 py-2.5 active:opacity-70 dark:border-slate-800"
                  >
                    <Text className="w-6 text-center text-sm font-semibold text-slate-500">
                      {row.position ?? '–'}
                    </Text>
                    <View className="flex-1 flex-row items-center pr-2">
                      <Avatar
                        uri={teamLogoUri(row.teamId, 48)}
                        fallbackUri={row.teamLogoUrl}
                        name={row.teamName}
                        size={22}
                      />
                      <Text numberOfLines={1} className="ml-2 flex-1 text-sm font-medium">
                        {clubName(row.teamName) || row.teamShortName || row.teamName}
                      </Text>
                    </View>
                    <Text className={`${COL_WIDTHS} text-center text-sm text-slate-600 dark:text-slate-300`}>
                      {row.played}
                    </Text>
                    <Text className={`${COL_WIDTHS} text-center text-sm text-slate-600 dark:text-slate-300`}>
                      {row.won}
                    </Text>
                    <Text className={`${COL_WIDTHS} text-center text-sm text-slate-600 dark:text-slate-300`}>
                      {row.drawn}
                    </Text>
                    <Text className={`${COL_WIDTHS} text-center text-sm text-slate-600 dark:text-slate-300`}>
                      {row.lost}
                    </Text>
                    <Text className={`${COL_WIDTHS} text-center text-sm font-bold text-slate-900 dark:text-slate-100`}>
                      {row.points}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            <AdBanner variant="list" />
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            {/* Filtro de jornadas si hay rondas */}
            {rounds.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mx-3 mt-3">
                <View className="flex-row gap-1.5">
                  <Pressable
                    onPress={() => setSelectedRound(null)}
                    className={`rounded-lg px-2.5 py-1 ${
                      selectedRound === null
                        ? 'bg-rink-passion dark:bg-accent'
                        : 'bg-white dark:bg-slate-900'
                    }`}
                  >
                    <Text
                      className={`text-xs font-semibold ${
                        selectedRound === null
                          ? 'text-white dark:text-slate-900'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {t('competitions.tab_all')}
                    </Text>
                  </Pressable>
                  {rounds.map((r) => {
                    const isSelected = selectedRound === r.number;
                    return (
                      <Pressable
                        key={r.id}
                        onPress={() => setSelectedRound(r.number)}
                        className={`rounded-lg px-2.5 py-1 ${
                          isSelected
                            ? 'bg-rink-passion dark:bg-accent'
                            : 'bg-white dark:bg-slate-900'
                        }`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            isSelected
                              ? 'text-white dark:text-slate-900'
                              : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {r.name ?? `J${r.number}`}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            ) : null}

            {matchesByRound.length === 0 ? (
              <EmptyState title={t('team.no_season_matches')} />
            ) : (
              <View className="mt-2">
                {matchesByRound.map((m: SeasonOverviewMatch) => {
                  const live = isEffectivelyLive(m.status, m.scheduledAt);
                  const isFinal = m.status === 'finished';
                  const dateLabel = formatDayLabel(m.scheduledAt);
                  const when = isFinal
                    ? dateLabel
                      ? `${t('match_states.final')} · ${dateLabel}`
                      : t('match_states.final')
                    : live
                      ? ''
                      : formatKickoff(m.scheduledAt);

                  return (
                    <Pressable
                      key={m.id}
                      onPress={() => router.push(`/match/${m.id}`)}
                      className="mx-3 my-1 rounded-xl bg-white p-3 active:opacity-70 dark:bg-slate-900"
                    >
                      <View className="flex-row items-center justify-between">
                        <Text className="text-xs text-slate-500">
                          {m.roundName ?? (m.roundNumber ? `Jornada ${m.roundNumber}` : when)}
                        </Text>
                        {live ? (
                          <View className="flex-row items-center gap-1 rounded-full bg-live-deep px-2 py-0.5">
                            <View className="h-1.5 w-1.5 rounded-full bg-white" />
                            <Text className="text-xs font-bold text-white">
                              {t('match_states.live')}
                            </Text>
                          </View>
                        ) : (
                          <Text className="text-xs text-slate-500">{when}</Text>
                        )}
                      </View>

                      <View className="mt-2 flex-row items-center justify-between">
                        <View className="flex-1 flex-row items-center pr-1">
                          <Avatar
                            uri={teamLogoUri(m.homeTeam.id, 64)}
                            fallbackUri={m.homeTeam.logoUrl}
                            name={m.homeTeam.name}
                            size={24}
                          />
                          <Text numberOfLines={1} className="ml-2 flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                            {clubName(m.homeTeam.name) || m.homeTeam.shortName || m.homeTeam.name}
                          </Text>
                        </View>
                        <Text className="px-3 font-mono text-base font-extrabold tabular-nums text-slate-900 dark:text-slate-50">
                          {live || isFinal
                            ? `${m.score.home ?? 0} - ${m.score.away ?? 0}`
                            : 'vs'}
                        </Text>
                        <View className="flex-1 flex-row items-center justify-end pl-1">
                          <Text numberOfLines={1} className="mr-2 flex-1 text-right text-sm font-semibold text-slate-800 dark:text-slate-100">
                            {clubName(m.awayTeam.name) || m.awayTeam.shortName || m.awayTeam.name}
                          </Text>
                          <Avatar
                            uri={teamLogoUri(m.awayTeam.id, 64)}
                            fallbackUri={m.awayTeam.logoUrl}
                            name={m.awayTeam.name}
                            size={24}
                          />
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
            <AdBanner variant="list" />
          </ScrollView>
        )}
      </View>
    </>
  );
}
