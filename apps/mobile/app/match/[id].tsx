import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { useEffect } from 'react';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useMatchDetail } from '@/src/hooks/queries';
import { useMatchLive } from '@/src/hooks/useMatchLive';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { EventRow } from '@/src/components/match/EventRow';
import { capture } from '@/src/lib/analytics';

export default function MatchScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const matchId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { t } = useLocale();
  const query = useMatchDetail(matchId ?? '');
  // la sesión llega en M3: mientras, sin token (el stream es público).
  const live = useMatchLive(matchId ?? '', undefined);

  // Analítica (Task 5.1): apertura de la ficha, una vez por matchId.
  useEffect(() => {
    if (matchId) capture('match_opened', { match_id: matchId });
  }, [matchId]);
  // live.detail y query.data comparten la misma caché de QueryClient; el stream
  // es la fuente en caliente y la query el fallback en frío.
  const current = live.detail ?? query.data;

  if (!current) {
    return query.isError ? (
      <ErrorState onRetry={() => void query.refetch()} />
    ) : (
      <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark" />
    );
  }

  const m = current.match;
  return (
    <>
      <Stack.Screen
        options={{
          title: `${m.homeTeam.shortName ?? m.homeTeam.name} - ${m.awayTeam.shortName ?? m.awayTeam.name}`,
        }}
      />
      <ScrollView className="bg-rink-floor dark:bg-rink-floor-dark">
        {/* Marcador */}
        <View className="mx-3 mt-2 items-center rounded-xl bg-white p-4 dark:bg-slate-900">
          <Text className="text-xs uppercase text-slate-500">{m.competitionName}</Text>
          <View className="mt-2 flex w-full flex-row items-center justify-between">
            <Text className="flex-1 text-center font-semibold">{m.homeTeam.shortName ?? m.homeTeam.name}</Text>
            <Text className="px-3 font-mono text-4xl font-bold">
              {m.score.home ?? 0} - {m.score.away ?? 0}
            </Text>
            <Text className="flex-1 text-center font-semibold">{m.awayTeam.shortName ?? m.awayTeam.name}</Text>
          </View>
          {/* El poll degradado se muestra aunque lleguen datos; distingue SSE de poll */}
          <Text className="mt-1 text-xs text-slate-500">
            {live.transport === 'poll'
              ? t('match_detail.live_poll')
              : live.connected
                ? t('match_detail.live_connected')
                : t('match_detail.connecting')}
          </Text>
        </View>
        {/* Eventos (el más reciente arriba) */}
        <Text className="px-4 pb-1 pt-4 text-xs font-bold uppercase text-slate-500">{t('match_tabs.events')}</Text>
        {[...current.events].reverse().map((e) => (
          <EventRow key={e.id} event={e} />
        ))}
        {/* Alineaciones (titulares primero) */}
        <Text className="px-4 pb-1 pt-4 text-xs font-bold uppercase text-slate-500">{t('match_tabs.lineups')}</Text>
        <View className="flex-row px-3 pb-6">
          <View className="flex-1">
            {current.lineups.home.filter((l) => l.isStarter).map((l) => (
              <Text key={`${l.jerseyNumber ?? ''}-${l.playerName}`} className="text-sm">
                {l.jerseyNumber ?? ''}. {l.playerName}
                {l.isCaptain ? ' (C)' : ''}
              </Text>
            ))}
          </View>
          <View className="flex-1">
            {current.lineups.away.filter((l) => l.isStarter).map((l) => (
              <Text key={`${l.jerseyNumber ?? ''}-${l.playerName}`} className="text-right text-sm">
                {l.jerseyNumber ?? ''}. {l.playerName}
                {l.isCaptain ? ' (C)' : ''}
              </Text>
            ))}
          </View>
        </View>
      </ScrollView>
    </>
  );
}
