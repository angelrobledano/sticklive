import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '@/src/i18n/LocaleContext';
import { usePlayer } from '@/src/hooks/queries';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { PlayerDetailSkeleton } from '@/src/components/shared/Skeleton';
import { ShareHeaderButton } from '@/src/components/shared/ShareHeaderButton';
import { Avatar, playerPhotoUri, teamLogoUri } from '@/src/components/shared/Avatar';
import { FollowButton } from '@/src/components/favorite/FollowButton';
import { clubName, playerDisplayName } from '@/src/lib/names';

/**
 * Ficha de jugador (Task 2.5) — `GET /players/:id` (PlayerDetail en types.ts,
 * shapes verificados por lectura de player-detail.ts:276-310 y
 * lib/player-career.ts:76-79). Mínimo razonable: cabecera con foto, equipo
 * actual, totales de temporada y trayectoria por temporadas/equipos.
 */
export default function PlayerScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const playerId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { t } = useLocale();
  const query = usePlayer(playerId ?? '');

  const rawPlayer = query.data?.player;
  const displayName = rawPlayer ? playerDisplayName(rawPlayer.firstName, rawPlayer.lastName) : '';

  const handleShare = () => {
    if (!rawPlayer) return;
    void Share.share({
      message: `${displayName} | Stick Live\nhttps://sticklive.eu/players/${rawPlayer.id}`,
      url: `https://sticklive.eu/players/${rawPlayer.id}`,
      title: displayName,
    });
  };

  const headerElement = (
    <Stack.Screen
      options={{
        title: displayName,
        headerRight: () =>
          displayName ? (
            <ShareHeaderButton
              onPress={handleShare}
              accessibilityLabel="Compartir jugador"
            />
          ) : null,
      }}
    />
  );

  if (!query.data) {
    return (
      <>
        {headerElement}
        {query.isError ? (
          <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
            <ErrorState onRetry={() => void query.refetch()} />
          </View>
        ) : (
          <PlayerDetailSkeleton />
        )}
      </>
    );
  }

  const { player, currentTeam, seasonTotals, career } = query.data;
  const sectionTitle = 'px-4 pb-1 pt-4 text-xs font-bold uppercase text-slate-500';
  const statBox = 'flex-1 items-center rounded-xl bg-white p-3 dark:bg-slate-900';

  return (
    <>
      {headerElement}
      <ScrollView
        className="flex-1 bg-rink-floor dark:bg-rink-floor-dark"
        contentContainerStyle={{ paddingBottom: Math.max(32, insets.bottom + 16) }}
      >
        {/* Cabecera */}
        <View className="items-center rounded-xl bg-white p-4 mx-3 mt-2 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
          <Avatar
            uri={playerPhotoUri(player.id, 192)}
            name={displayName}
            size={80}
            variant="player"
          />
          <Text className="mt-2 text-center text-lg font-bold text-slate-900 dark:text-slate-100">
            {displayName}
          </Text>
          <View className="mt-1 flex-row items-center gap-2">
            {player.isGoalkeeper ? (
              <Text className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {t('player.pos_gk')}
              </Text>
            ) : null}
            {player.nationality ? <Text className="text-xs text-slate-500">{player.nationality}</Text> : null}
          </View>
          <View className="mt-2">
            <FollowButton kind="player" refId={player.id} name={displayName} />
          </View>
        </View>

        {/* Equipo actual → ficha del equipo */}
        {currentTeam ? (
          <>
            <Text className={sectionTitle}>{t('player.current_team')}</Text>
            <Pressable
              onPress={() => router.push(`/team/${currentTeam.id}`)}
              className="flex-row items-center rounded-xl bg-white p-3 mx-3 active:opacity-70 dark:bg-slate-900 border border-slate-100 dark:border-slate-800"
            >
              <Avatar
                uri={teamLogoUri(currentTeam.id)}
                name={currentTeam.name}
                size={28}
              />
              <Text numberOfLines={1} className="ml-3 flex-1 text-base font-medium">
                {clubName(currentTeam.name) || currentTeam.name}
                {currentTeam.jerseyNumber != null ? ` · #${currentTeam.jerseyNumber}` : ''}
              </Text>
            </Pressable>
          </>
        ) : null}

        {/* Totales de la temporada activa */}
        <View className="mx-3 mt-3 flex-row gap-2">
          <View className={statBox}>
            <Text className="text-xl font-bold">{seasonTotals.pj}</Text>
            <Text className="text-[11px] uppercase text-slate-500">{t('player.col_pj')}</Text>
          </View>
          <View className={statBox}>
            <Text className="text-xl font-bold">{seasonTotals.goals}</Text>
            <Text className="text-[11px] uppercase text-slate-500">{t('player.col_g')}</Text>
          </View>
          <View className={statBox}>
            <Text className="text-xl font-bold">{seasonTotals.assists}</Text>
            <Text className="text-[11px] uppercase text-slate-500">{t('player.col_as')}</Text>
          </View>
        </View>

        {/* Trayectoria: campañas de más reciente a más antigua */}
        <Text className={sectionTitle}>{t('player.career')}</Text>
        {career.seasons.length === 0 ? (
          <Text className="px-4 pb-6 text-sm text-slate-500">{t('player.no_comp_records')}</Text>
        ) : (
          <View className="mx-3 mb-6 overflow-hidden rounded-xl bg-white dark:bg-slate-900">
            {career.seasons.map((season) => (
              <View key={season.seasonId} className="border-b border-slate-100 px-3 py-2.5 last:border-b-0 dark:border-slate-800">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-bold">
                    {season.seasonName}
                    {season.isCurrent ? (
                      <Text className="ml-2 text-xs font-normal text-rink-passion"> · {t('player.career_current')}</Text>
                    ) : null}
                  </Text>
                  <Text className="text-xs text-slate-500">{season.competitionName}</Text>
                </View>
                {season.teams.map((team) => (
                  <Pressable
                    // competitionId en la key: el mismo equipo podría repetirse
                    // en la trayectoria con distinta competición (CareerTeamEntry
                    // lo trae, player-career.ts:51).
                    key={`${team.competitionId}-${team.teamId}`}
                    onPress={() => router.push(`/team/${team.teamId}`)}
                    className="mt-0.5 flex-row items-center justify-between active:opacity-70"
                  >
                    <Text numberOfLines={1} className="flex-1 text-sm text-slate-700 dark:text-slate-300">
                      {clubName(team.teamName) || team.teamName}
                    </Text>
                    <Text className="ml-2 text-xs tabular-nums text-slate-500">
                      {team.pj === 0 && team.goals === 0 ? '' : `${team.pj} ${t('player.col_pj')} · ${team.goals} ${t('player.col_g')}`}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
            <View className="flex-row items-center justify-between bg-slate-50 px-3 py-2.5 dark:bg-slate-800">
              <Text className="text-sm font-semibold">{t('player.career_totals')}</Text>
              <Text className="text-xs tabular-nums text-slate-500">
                {career.totals.pj} {t('player.col_pj')} · {career.totals.goals} {t('player.col_g')}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </>
  );
}
