import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useCompetitions, useStandings } from '@/src/hooks/queries';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { AdBanner } from '@/src/components/ads/AdBanner';

/**
 * Tab de clasificación (Task 2.5). Chips de competición (sólo las que tienen
 * temporada activa: sin `season` no hay clasificación que mostrar) + tabla
 * PJ/G/E/D/PTS con escudos servidos por el API. Filas SNAKE_CASE de
 * /seasons/:id/standings (ver StandingsRow en types.ts).
 */

const COL_WIDTHS = 'w-7' as const;

export default function StandingsScreen() {
  const router = useRouter();
  const { t } = useLocale();
  const competitions = useCompetitions();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Sólo competiciones con temporada activa: sin `season` no hay standings.
  const withSeason = useMemo(
    () => (competitions.data ?? []).filter((c) => c.season != null),
    [competitions.data],
  );

  // El chip seleccionado cae si el refetch lo quita: fallback a la primera.
  const selected = withSeason.find((c) => c.id === selectedId) ?? withSeason[0];
  const standings = useStandings(selected?.season?.id ?? undefined);

  if (competitions.isPending) {
    return <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark" />;
  }
  if (competitions.isError) {
    return (
      <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
        <ErrorState onRetry={() => void competitions.refetch()} />
      </View>
    );
  }
  if (withSeason.length === 0) {
    return (
      <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
        <EmptyState title={t('standings.no_data')} />
      </View>
    );
  }

  const rows = standings.data ?? [];

  return (
    <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
      {/* Chips de competición */}
      <View className="border-b border-slate-200 bg-white py-2 dark:border-slate-800 dark:bg-slate-900">
        <FlatList
          horizontal
          data={withSeason}
          keyExtractor={(c) => c.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}
          renderItem={({ item }) => {
            const active = item.id === selected?.id;
            return (
              <Pressable
                onPress={() => setSelectedId(item.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                className={`min-h-[44px] justify-center rounded-full px-3 active:opacity-70 ${
                  active ? 'bg-rink-passion' : 'bg-slate-100 dark:bg-slate-800'
                }`}
              >
                <Text
                  numberOfLines={1}
                  className={`text-sm font-semibold ${active ? 'text-white' : 'text-slate-700 dark:text-slate-200'}`}
                >
                  {item.name}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      {/* Cabecera de columnas */}
      <View className="flex-row items-center px-3 py-2">
        <Text className="w-6 text-[11px] font-bold text-slate-500">#</Text>
        <Text className="flex-1 text-[11px] font-bold uppercase text-slate-500">{t('standings.team')}</Text>
        <Text className={`${COL_WIDTHS} text-center text-[11px] font-bold text-slate-500`}>{t('standings.cols.played')}</Text>
        <Text className={`${COL_WIDTHS} text-center text-[11px] font-bold text-slate-500`}>{t('standings.cols.won')}</Text>
        <Text className={`${COL_WIDTHS} text-center text-[11px] font-bold text-slate-500`}>{t('standings.cols.drawn')}</Text>
        <Text className={`${COL_WIDTHS} text-center text-[11px] font-bold text-slate-500`}>{t('standings.cols.lost')}</Text>
        <Text className={`${COL_WIDTHS} text-center text-[11px] font-bold text-slate-500`}>{t('standings.cols.pts')}</Text>
      </View>

      {standings.isPending ? (
        <View className="flex-1" />
      ) : standings.isError ? (
        <ErrorState onRetry={() => void standings.refetch()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingBottom: 24 }}
          // Datos previos mientras carga el chip nuevo (keepPreviousData):
          // atenuados para que no se lean como definitivos.
          style={standings.isPlaceholderData ? { opacity: 0.6 } : undefined}
          ListEmptyComponent={<EmptyState title={t('standings.no_data')} />}
          ListFooterComponent={<AdBanner variant="list" />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/team/${item.team_id}`)}
              className="flex-row items-center border-b border-slate-100 bg-white px-3 py-2 active:opacity-70 dark:border-slate-800 dark:bg-slate-900"
            >
              <Text className="w-6 text-sm font-semibold text-slate-500">{item.position ?? '–'}</Text>
              <View className="flex-1 flex-row items-center pr-2">
                <Avatar uri={teamLogoUri(item.team_id)} name={item.team_name} size={24} />
                <Text numberOfLines={1} className="ml-2 flex-1 text-sm font-medium">
                  {item.team_short_name ?? item.team_name}
                </Text>
              </View>
              <Text className={`${COL_WIDTHS} text-center text-sm tabular-nums`}>{item.played}</Text>
              <Text className={`${COL_WIDTHS} text-center text-sm tabular-nums`}>{item.won}</Text>
              <Text className={`${COL_WIDTHS} text-center text-sm tabular-nums`}>{item.drawn}</Text>
              <Text className={`${COL_WIDTHS} text-center text-sm tabular-nums`}>{item.lost}</Text>
              <Text className={`${COL_WIDTHS} text-center text-sm font-bold tabular-nums`}>{item.points}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
