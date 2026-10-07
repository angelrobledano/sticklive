import { Stack, useLocalSearchParams, useIsFocused } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useMatchDetail } from '@/src/hooks/queries';
import { useMatchLive } from '@/src/hooks/useMatchLive';
import { useInterstitialOnLeave } from '@/src/hooks/ads/useInterstitialOnLeave';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { EventRow } from '@/src/components/match/EventRow';
import { AdBanner } from '@/src/components/ads/AdBanner';
import { capture } from '@/src/lib/analytics';
import { isEffectivelyLive } from '@/src/lib/time';

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

  // Reloj del desfase (Task 5.2): sólo corre mientras el stream está marcado
  // como stale (los datos están congelados y el "hace N s" avanza); con la
  // recuperación el intervalo se limpia y no hay re-renders extra. La ficha
  // sigue montada en el stack al desenfocarse, así que el reloj se gatea
  // además por foco (useIsFocused): nada late con la pantalla en segundo
  // plano (spec §4).
  const [now, setNow] = useState(() => Date.now());
  const focused = useIsFocused();
  useEffect(() => {
    if (!live.stale || !focused) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live.stale, focused]);

  // live.detail y query.data comparten la misma caché de QueryClient; el stream
  // es la fuente en caliente y la query el fallback en frío.
  const current = live.detail ?? query.data;

  // Plan D Task 5: interstitial al SALIR de una ficha NO en vivo (el hook
  // precarga y decide; en partido en directo o ruta de push NUNCA). Antes de
  // cualquier return temprano: reglas de hooks.
  useInterstitialOnLeave(current?.match.status, current?.match.scheduledAt);

  if (!current) {
    return query.isError ? (
      <ErrorState onRetry={() => void query.refetch()} />
    ) : (
      <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark" />
    );
  }

  const m = current.match;
  const finished = m.status === 'finished';
  // Edad del desfase en segundos (el locale lleva el placeholder {s}, igual
  // que search.hint con {n}: t() del móvil no interpola).
  const staleSeconds =
    live.stale && live.staleAt != null ? Math.max(0, Math.round((now - live.staleAt) / 1000)) : 0;
  return (
    <>
      <Stack.Screen
        options={{
          title: `${m.homeTeam.shortName ?? m.homeTeam.name} - ${m.awayTeam.shortName ?? m.awayTeam.name}`,
        }}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} className="bg-rink-floor dark:bg-rink-floor-dark">
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
          {/* Estado del canal/datos: final > poll > desfase > conectado > conectando.
              En finished el hub muere y cierra: "conectado" sería engañoso (Task 5.2). */}
          <Text
            className={`mt-1 text-xs ${
              live.stale && !finished ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'
            }`}
          >
            {finished
              ? t('match_detail.finished')
              : live.transport === 'poll'
                ? t('match_detail.live_poll')
                : live.stale
                  ? t('match_detail.freshness_stale').replace('{s}', String(staleSeconds))
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
        {/* Banner solo si el partido NO está en vivo (spec §7: en vivo nada
            toca la pantalla; `isEffectivelyLive` es la fuente única, igual
            que la home). El DTO del detalle ya trae el estado EFECTIVO. */}
        {!isEffectivelyLive(m.status, m.scheduledAt) ? <AdBanner variant="match" /> : null}
      </ScrollView>
    </>
  );
}
