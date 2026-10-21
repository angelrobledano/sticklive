import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  PLAYOFF_PHASES,
  type PlayoffPhase,
  type PlayoffSeries,
  advancedFrom,
  buildSeries,
  groupByPhase,
  seriesWinnerId,
} from '@/src/lib/playoff';
import type { SeasonOverviewMatch } from '@/src/lib/api/types';

function MicroSeries({
  serie,
  advanced,
  isFinal = false,
}: {
  serie: PlayoffSeries;
  advanced: Set<string>;
  isFinal?: boolean;
}) {
  const single = serie.games.length === 1 ? serie.games[0]! : null;
  const singleScored =
    !!single && (single.status === 'finished' || single.status === 'live');
  const championId = isFinal ? seriesWinnerId(serie) : null;

  const rows = [
    { team: serie.teamA, wins: serie.winsA, score: single?.score.home ?? null },
    { team: serie.teamB, wins: serie.winsB, score: single?.score.away ?? null },
  ];

  return (
    <View className="w-32 justify-center rounded-lg border border-slate-200 bg-white p-2 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      {rows.map(({ team, wins, score }, idx) => {
        const isChampion = championId === team.id;
        const qualified = advanced.has(team.id) || isChampion;
        const value = single ? (singleScored && score != null ? score : '–') : wins;

        return (
          <View
            key={team.id}
            className={`flex-row items-center justify-between py-1 ${
              idx === 0 ? 'border-b border-slate-100 dark:border-slate-800' : ''
            }`}
          >
            <View className="flex-1 flex-row items-center gap-1 pr-1">
              <Text
                numberOfLines={1}
                className={`text-xs ${
                  qualified
                    ? 'font-bold text-slate-900 dark:text-slate-100'
                    : 'font-medium text-slate-600 dark:text-slate-400'
                }`}
              >
                {team.shortName ?? team.name.slice(0, 3).toUpperCase()}
              </Text>
              {isChampion ? (
                <Ionicons name="trophy" size={12} color="#ef4444" />
              ) : qualified ? (
                <Ionicons name="checkmark-sharp" size={12} color="#10b981" />
              ) : null}
            </View>
            <Text className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
              {value}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function PlayoffBracket({ matches }: { matches: SeasonOverviewMatch[] }) {
  const phases = useMemo(() => {
    const byPhase = groupByPhase(matches);
    const series: Record<PlayoffPhase, PlayoffSeries[]> = {
      Cuartos: buildSeries(byPhase.Cuartos),
      Semis: buildSeries(byPhase.Semis),
      Final: buildSeries(byPhase.Final),
    };
    return series;
  }, [matches]);

  const advanced: Record<PlayoffPhase, Set<string>> = useMemo(
    () => ({
      Cuartos: advancedFrom(phases.Semis),
      Semis: advancedFrom(phases.Final),
      Final: new Set<string>(),
    }),
    [phases],
  );

  const activePhases = PLAYOFF_PHASES.filter((p) => phases[p].length > 0);
  if (activePhases.length === 0) return null;

  // Altura calculada para que todas las columnas de fases (Cuartos, Semis, Final)
  // tengan la misma altura y sus tarjetas se centren verticalmente de forma armónica.
  const maxSeriesCount = Math.max(...activePhases.map((p) => phases[p].length), 1);
  const minBracketHeight =
    maxSeriesCount > 1 ? maxSeriesCount * 58 + (maxSeriesCount - 1) * 8 : undefined;

  return (
    <View className="mb-3 rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <View className="mb-2.5 flex-row items-center gap-1.5">
        <Ionicons name="git-network-outline" size={14} color="#64748b" />
        <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Cuadro de eliminatorias
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 14, paddingBottom: 2, alignItems: 'stretch' }}
      >
        {activePhases.map((phase) => (
          <View key={phase} style={{ alignSelf: 'stretch' }}>
            <Text className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {phase}
            </Text>
            <View
              style={{
                flex: 1,
                minHeight: minBracketHeight,
                justifyContent: 'space-around',
                gap: 8,
              }}
            >
              {phases[phase].map((serie, i) => (
                <MicroSeries
                  key={i}
                  serie={serie}
                  advanced={advanced[phase]}
                  isFinal={phase === 'Final'}
                />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
