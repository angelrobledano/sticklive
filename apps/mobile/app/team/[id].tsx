import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useTeam } from '@/src/hooks/queries';
import { FollowButton } from '@/src/components/favorite/FollowButton';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { formatDayLabel, formatKickoff, isEffectivelyLive } from '@/src/lib/time';

/**
 * Ficha de equipo (Task 2.5) — `GET /teams/:id` (TeamDetail en types.ts, shape
 * verificado por lectura de team-detail.ts:458). Los partidos tienen shape
 * PROPIO (sin competitionName/isHalftime), así que se pintan filas locales
 * equipo-vs-equipo en vez de forzar MatchCard.
 */
export default function TeamScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const teamId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { t } = useLocale();
  const query = useTeam(teamId ?? '');

  if (!query.data) {
    return query.isError ? (
      <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
        <ErrorState onRetry={() => void query.refetch()} />
      </View>
    ) : (
      <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark" />
    );
  }

  const { team, standing, matches, squad } = query.data;
  const sectionTitle = 'px-4 pb-1 pt-4 text-xs font-bold uppercase text-slate-500';

  return (
    <>
      <Stack.Screen options={{ title: team.shortName ?? team.name }} />
      <ScrollView className="bg-rink-floor dark:bg-rink-floor-dark">
        {/* Cabecera (la estrella de seguir es un favorito del EQUIPO, no del partido) */}
        <View className="relative items-center rounded-xl bg-white p-4 mx-3 mt-2 dark:bg-slate-900">
          <View className="absolute right-1 top-1">
            <FollowButton kind="team" refId={team.id} />
          </View>
          <Avatar uri={teamLogoUri(team.id, 192)} name={team.name} size={72} />
          <Text className="mt-2 text-center text-lg font-bold">{team.name}</Text>
          {team.sectionSuffix ? <Text className="text-xs text-slate-500">{team.sectionSuffix}</Text> : null}
        </View>

        {/* Clasificación (temporada activa) */}
        {standing ? (
          <View className="rounded-xl bg-white p-4 mx-3 mt-3 dark:bg-slate-900">
            <Text className="text-xs uppercase text-slate-500">{standing.competitionName}</Text>
            <View className="mt-2 flex-row items-center justify-between">
              <Text className="text-sm text-slate-600 dark:text-slate-300">
                {t('team.position')}: <Text className="font-bold">{standing.position ?? '–'}</Text>
              </Text>
              <Text className="text-sm text-slate-600 dark:text-slate-300">
                {t('team.points')}: <Text className="font-bold">{standing.points}</Text>
              </Text>
            </View>
            <Text className="mt-1 text-xs text-slate-500">
              {standing.played} {t('team.played').toLowerCase()} · {standing.won} {t('team.won').toLowerCase()} ·{' '}
              {standing.drawn} {t('team.drawn').toLowerCase()} · {standing.lost} {t('team.lost').toLowerCase()}
            </Text>
          </View>
        ) : null}

        {/* Calendario de la temporada (shape propio de team-detail; filas locales) */}
        <Text className={sectionTitle}>{t('team.calendar')}</Text>
        {matches.length === 0 ? (
          <Text className="px-4 py-2 text-sm text-slate-500">{t('team.no_season_matches')}</Text>
        ) : (
          matches.map((m) => {
            const live = isEffectivelyLive(m.status, m.scheduledAt);
            const showScore = live || m.status === 'finished';
            // En finished, la fecha distingue filas del calendario (formatDayLabel
            // devuelve '' si no hay fecha → sin separador colgante).
            const dateLabel = formatDayLabel(m.scheduledAt);
            const when = m.status === 'finished'
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
                  <Text className="text-xs text-slate-500">{when}</Text>
                  {live ? (
                    <View className="flex-row items-center gap-1 rounded-full bg-live-deep px-2 py-0.5">
                      <View className="h-1.5 w-1.5 rounded-full bg-white" />
                      <Text className="text-[10px] font-bold text-white">{t('match_states.live')}</Text>
                    </View>
                  ) : null}
                </View>
                <View className="mt-1 flex-row items-center justify-between">
                  <Text numberOfLines={1} className="flex-1 text-base font-semibold">
                    {m.homeTeam.shortName ?? m.homeTeam.name}
                  </Text>
                  <Text className="px-2 font-mono text-lg font-bold">
                    {showScore ? `${m.score.home ?? 0} - ${m.score.away ?? 0}` : 'vs'}
                  </Text>
                  <Text numberOfLines={1} className="flex-1 text-right text-base font-semibold">
                    {m.awayTeam.shortName ?? m.awayTeam.name}
                  </Text>
                </View>
              </Pressable>
            );
          })
        )}

        {/* Plantilla */}
        <Text className={sectionTitle}>{t('team.squad')}</Text>
        {squad.length === 0 ? (
          <Text className="px-4 pb-6 text-sm text-slate-500">{t('team.squad_empty')}</Text>
        ) : (
          <View className="mx-3 mb-6 overflow-hidden rounded-xl bg-white dark:bg-slate-900">
            {squad.map((p) => (
              <Pressable
                key={p.playerId}
                onPress={() => router.push(`/player/${p.playerId}`)}
                className="flex-row items-center border-b border-slate-100 px-3 py-2.5 active:opacity-70 last:border-b-0 dark:border-slate-800"
              >
                <Text className="w-8 text-sm font-semibold text-slate-500">
                  {p.jerseyNumber != null ? p.jerseyNumber : ''}
                </Text>
                <Text numberOfLines={1} className="flex-1 text-sm font-medium">
                  {p.firstName} {p.lastName}
                  {p.isGoalkeeper ? <Text className="text-xs text-slate-500"> · {t('team.gk_short')}</Text> : null}
                </Text>
                {p.goals > 0 ? (
                  <Text className="text-xs text-slate-500">{p.goals} 🏑</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </>
  );
}
