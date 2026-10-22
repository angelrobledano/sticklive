import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { TeamDetail } from '@/src/lib/api/types';
import { buildKnockoutSummary, isKnockoutSeason } from '@/src/lib/knockout';
import { KnockoutSeasonSummary } from './KnockoutSeasonSummary';
import { MiniMatchCard } from './MiniMatchCard';
import { useLocale } from '@/src/i18n/LocaleContext';

interface Props {
  data: TeamDetail;
}

export function SummaryTab({ data }: Props) {
  const router = useRouter();
  const { t } = useLocale();
  const { standing, matches, team, season } = data;

  const koSeason = isKnockoutSeason(season, standing, matches);
  const koSummary = useMemo(
    () => (koSeason ? buildKnockoutSummary(team.id, data.knockoutMatches ?? matches) : null),
    [koSeason, team.id, data.knockoutMatches, matches],
  );

  if (koSeason) {
    return <KnockoutSeasonSummary data={data} summary={koSummary} />;
  }

  const nextMatch = matches.find((m) => m.status === 'scheduled' || m.status === 'live');
  const lastFinished = matches.filter((m) => m.status === 'finished').at(-1);

  return (
    <View className="space-y-3 mt-3">
      {/* Tarjeta de Clasificación */}
      {standing ? (
        <View className="mx-3 rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <View className="flex-row items-center justify-between mb-3">
            <Text numberOfLines={1} className="flex-1 text-xs font-bold uppercase tracking-wider text-slate-500 pr-2">
              {standing.competitionShort ?? standing.competitionName}
            </Text>
            {standing.competitionId ? (
              <Pressable
                onPress={() => router.push(`/competition/${standing.competitionId}`)}
                hitSlop={8}
                className="active:opacity-70"
              >
                <Text className="text-xs font-semibold text-rink-passion">
                  {t('team.view_full_table') || 'Veure taula'} →
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* Posición, Puntos, PJ, PG, PE, PP */}
          <View className="flex-row items-center justify-between py-2 border-y border-slate-100 dark:border-slate-800">
            <View className="items-center px-2">
              <Text className="text-2xl font-extrabold text-slate-900 dark:text-slate-50">
                {standing.position != null ? standing.position : '—'}
              </Text>
              <Text className="text-[10px] uppercase font-bold text-slate-400 mt-0.5">
                {t('team.position') || 'Pos.'}
              </Text>
            </View>

            <View className="h-8 w-px bg-slate-200 dark:bg-slate-700" />

            <View className="items-center px-2">
              <Text className="text-2xl font-extrabold text-rink-passion">
                {standing.points}
              </Text>
              <Text className="text-[10px] uppercase font-bold text-slate-400 mt-0.5">
                {t('team.points') || 'Pts.'}
              </Text>
            </View>

            <View className="h-8 w-px bg-slate-200 dark:bg-slate-700" />

            <View className="flex-row gap-3">
              {[
                [t('standings.cols.played') || 'PJ', standing.played],
                [t('standings.cols.won') || 'PG', standing.won],
                [t('standings.cols.drawn') || 'PE', standing.drawn],
                [t('standings.cols.lost') || 'PP', standing.lost],
              ].map(([lbl, val]) => (
                <View key={lbl as string} className="items-center">
                  <Text className="text-base font-bold text-slate-800 dark:text-slate-200">
                    {val as number}
                  </Text>
                  <Text className="text-[10px] uppercase font-bold text-slate-400 mt-0.5">
                    {lbl as string}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* Goles a favor, en contra, diferencia */}
          <View className="flex-row justify-around pt-3 text-xs">
            <Text className="text-xs text-slate-500">
              {t('standings.cols.gf') || 'GF'}: <Text className="font-bold text-slate-800 dark:text-slate-200">{standing.goalsFor ?? '—'}</Text>
            </Text>
            <Text className="text-xs text-slate-500">
              {t('standings.cols.ga') || 'GC'}: <Text className="font-bold text-slate-800 dark:text-slate-200">{standing.goalsAgainst ?? '—'}</Text>
            </Text>
            <Text className="text-xs text-slate-500">
              {t('standings.cols.gd') || 'DG'}:{' '}
              <Text
                className={`font-bold ${
                  standing.goalDiff >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {standing.goalDiff >= 0 ? `+${standing.goalDiff}` : standing.goalDiff}
              </Text>
            </Text>
          </View>
        </View>
      ) : (
        <View className="mx-3 rounded-2xl border border-slate-100 bg-white p-5 items-center dark:border-slate-800 dark:bg-slate-900">
          <Text className="text-sm text-slate-400">
            {t('standings.no_data') || 'Sense dades de classificació'}
          </Text>
        </View>
      )}

      {/* Próximo partido */}
      {nextMatch ? (
        <View className="mx-3 overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <View className="px-4 pt-3 pb-1 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
            <Text className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              {nextMatch.status === 'live' ? `🟢 ${t('team.now') || 'En joc'}` : t('team.next_match') || 'Pròxim partit'}
            </Text>
          </View>
          <MiniMatchCard match={nextMatch} teamId={team.id} />
        </View>
      ) : null}

      {/* Último resultado */}
      {lastFinished ? (
        <View className="mx-3 overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <View className="px-4 pt-3 pb-1 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
            <Text className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              {t('team.last_result') || 'Últim resultat'}
            </Text>
          </View>
          <MiniMatchCard match={lastFinished} teamId={team.id} />
        </View>
      ) : null}
    </View>
  );
}
