import { useMemo, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale } from '@/src/i18n/LocaleContext';
import { usePlayer } from '@/src/hooks/queries';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { PlayerDetailSkeleton } from '@/src/components/shared/Skeleton';
import { ShareHeaderButton } from '@/src/components/shared/ShareHeaderButton';
import { Avatar, playerPhotoUri, teamLogoUri } from '@/src/components/shared/Avatar';
import { FollowButton } from '@/src/components/favorite/FollowButton';
import { clubName, playerDisplayName } from '@/src/lib/names';
import { buildPlayerFacts } from '@/src/lib/player-facts';
import { PlayerFacts } from '@/src/components/player/PlayerFacts';
import { CompStatsTable } from '@/src/components/player/CompStatsTable';
import { ShareImageModal } from '@/src/components/shared/ShareImageModal';

function calcAge(birthDate?: string | null): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export default function PlayerScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const playerId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { t, locale } = useLocale();
  const query = usePlayer(playerId ?? '');
  const [shareImageModalOpen, setShareImageModalOpen] = useState(false);

  const rawPlayer = query.data?.player;
  const displayName = rawPlayer ? playerDisplayName(rawPlayer.firstName, rawPlayer.lastName) : '';

  const handleShare = () => {
    if (!rawPlayer) return;
    setShareImageModalOpen(true);
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

  const facts = useMemo(() => {
    return query.data ? buildPlayerFacts(query.data) : [];
  }, [query.data]);

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

  const { player, currentTeam, seasonTotals, career, statsByCompetition } = query.data;
  const age = calcAge(player.birthDate);
  const sectionTitle =
    'px-4 pb-1 pt-4 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400';
  const statBox =
    'flex-1 items-center rounded-xl bg-white p-3 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-xs';

  return (
    <>
      {headerElement}
      <ScrollView
        className="flex-1 bg-rink-floor dark:bg-rink-floor-dark"
        contentContainerStyle={{ paddingBottom: Math.max(32, insets.bottom + 16) }}
      >
        {/* Cabecera con foto y dorsal */}
        <View className="items-center rounded-2xl bg-white p-4 mx-3 mt-2 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-xs">
          <View className="relative">
            <Avatar
              uri={playerPhotoUri(player.id, 192)}
              name={displayName}
              size={80}
              variant="player"
            />
            {currentTeam?.jerseyNumber != null ? (
              <View className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-rink-passion items-center justify-center border-2 border-white dark:border-slate-900">
                <Text className="font-mono text-[10px] font-extrabold text-white">
                  {currentTeam.jerseyNumber}
                </Text>
              </View>
            ) : null}
          </View>

          <Text className="mt-2 text-center text-lg font-bold text-slate-900 dark:text-slate-50">
            {displayName}
          </Text>

          {/* Posición, nacionalidad y edad */}
          <View className="mt-1 flex-row items-center gap-2">
            {player.isGoalkeeper ? (
              <View className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                <Text className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  {t('player.pos_gk') || 'Portero'}
                </Text>
              </View>
            ) : null}
            {player.nationality ? (
              <Text className="text-xs text-slate-500 dark:text-slate-400">{player.nationality}</Text>
            ) : null}
            {age != null ? (
              <Text className="text-xs text-slate-500 dark:text-slate-400">
                · {age} {t('player.years') || 'años'}
              </Text>
            ) : null}
          </View>

          <View className="mt-3">
            <FollowButton kind="player" refId={player.id} name={displayName} />
          </View>
        </View>

        {/* Equipo actual → ficha del equipo */}
        {currentTeam ? (
          <>
            <Text className={sectionTitle}>{t('player.current_team') || 'Equipo actual'}</Text>
            <Pressable
              onPress={() => router.push(`/team/${currentTeam.id}`)}
              className="flex-row items-center rounded-2xl bg-white p-3 mx-3 active:opacity-70 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-xs"
            >
              <Avatar
                uri={teamLogoUri(currentTeam.id)}
                name={currentTeam.name}
                size={32}
              />
              <Text
                numberOfLines={1}
                className="ml-3 flex-1 text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                {clubName(currentTeam.name) || currentTeam.name}
                {currentTeam.jerseyNumber != null ? ` · #${currentTeam.jerseyNumber}` : ''}
              </Text>
            </Pressable>
          </>
        ) : null}

        {/* Totales de la temporada activa */}
        <Text className={sectionTitle}>{t('player.current_season') || 'Temporada actual'}</Text>
        <View className="mx-3 flex-row gap-2">
          <View className={statBox}>
            <Text className="font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {seasonTotals.pj}
            </Text>
            <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {t('player.col_pj') || 'PJ'}
            </Text>
          </View>
          <View className={statBox}>
            <Text className="font-mono text-xl font-bold tabular-nums text-rink-passion">
              {seasonTotals.goals}
            </Text>
            <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {t('player.col_g') || 'G'}
            </Text>
          </View>
          <View className={statBox}>
            <Text className="font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {seasonTotals.assists > 0 ? seasonTotals.assists : '—'}
            </Text>
            <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {t('player.col_as') || 'As'}
            </Text>
          </View>
          <View className={statBox}>
            <Text className="font-mono text-xl font-bold tabular-nums text-blue-500">
              {seasonTotals.blueCards > 0 ? seasonTotals.blueCards : '—'}
            </Text>
            <View className="flex-row items-center gap-1 mt-0.5">
              <View className="w-2 h-2.5 rounded-[1px] bg-blue-500 shadow-2xs" />
              <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {t('player.col_az') || 'Az'}
              </Text>
            </View>
          </View>
          <View className={statBox}>
            <Text className="font-mono text-xl font-bold tabular-nums text-red-500">
              {seasonTotals.redCards > 0 ? seasonTotals.redCards : '—'}
            </Text>
            <View className="flex-row items-center gap-1 mt-0.5">
              <View className="w-2 h-2.5 rounded-[1px] bg-red-500 shadow-2xs" />
              <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {t('player.col_rj') || 'Rj'}
              </Text>
            </View>
          </View>
        </View>

        {/* Penaltis anotados / lanzados */}
        {seasonTotals.penaltiesTotal > 0 ? (
          <View className="mx-3 mt-2 rounded-xl bg-white p-3 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 flex-row items-center justify-between">
            <Text className="text-xs text-slate-500 dark:text-slate-400">
              {t('player.pen_scored_shot') || 'Penaltis transformados / lanzados'}
            </Text>
            <Text className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {seasonTotals.penaltiesScored} / {seasonTotals.penaltiesTotal}
            </Text>
          </View>
        ) : null}

        {/* Hechos de temporada (PlayerFacts) */}
        {facts.length > 0 ? <PlayerFacts facts={facts} locale={locale} /> : null}

        {/* Rendimiento por competición */}
        {statsByCompetition && statsByCompetition.length > 0 ? (
          <CompStatsTable rows={statsByCompetition} />
        ) : null}

        {/* Trayectoria: campañas de más reciente a más antigua */}
        <Text className={sectionTitle}>{t('player.career') || 'Trayectoria'}</Text>
        {career.seasons.length === 0 ? (
          <Text className="px-4 pb-6 text-sm text-slate-500 dark:text-slate-400">
            {t('player.no_comp_records') || 'Sin registros de trayectoria'}
          </Text>
        ) : (
          <View className="mx-3 mb-6 overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-xs">
            {career.seasons.map((season) => (
              <View
                key={season.seasonId}
                className="border-b border-slate-100 px-3.5 py-3 last:border-b-0 dark:border-slate-800"
              >
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {season.seasonName}
                    {season.isCurrent ? (
                      <Text className="text-xs font-semibold text-rink-passion">
                        {' '}· {t('player.career_current') || 'Actual'}
                      </Text>
                    ) : null}
                  </Text>
                  <Text className="text-[11px] text-slate-400 font-medium">{season.competitionName}</Text>
                </View>
                {season.teams.map((team) => (
                  <Pressable
                    key={`${team.competitionId}-${team.teamId}`}
                    onPress={() => router.push(`/team/${team.teamId}`)}
                    className="mt-1 flex-row items-center justify-between active:opacity-70"
                  >
                    <Text numberOfLines={1} className="flex-1 text-xs font-medium text-slate-700 dark:text-slate-300">
                      {clubName(team.teamName) || team.teamName}
                    </Text>
                    <Text className="ml-2 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {team.pj === 0 && team.goals === 0
                        ? ''
                        : `${team.pj} ${t('player.col_pj') || 'PJ'} · ${team.goals} ${t('player.col_g') || 'G'}`}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
            <View className="flex-row items-center justify-between bg-slate-50 px-3.5 py-3 dark:bg-slate-800/60">
              <Text className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                {t('player.career_totals') || 'Totales de carrera'}
              </Text>
              <Text className="font-mono text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {career.totals.pj} {t('player.col_pj') || 'PJ'} · {career.totals.goals} {t('player.col_g') || 'G'}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Modal para compartir imagen de la ficha */}
      <ShareImageModal
        visible={shareImageModalOpen}
        onClose={() => setShareImageModalOpen(false)}
        imagePath={`/players/${player.id}/share-image`}
        name={displayName}
        kind="player"
      />
    </>
  );
}
