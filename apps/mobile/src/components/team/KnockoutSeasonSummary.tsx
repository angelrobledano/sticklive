import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { TeamDetail } from '@sports/core/api';
import { knockoutPhaseLabel, type KnockoutSummary } from '@sports/core/knockout';
import { MiniMatchCard } from './MiniMatchCard';
import { useLocale } from '@/src/i18n/LocaleContext';
import { clubName } from '@sports/core/names';

interface Props {
  data: TeamDetail;
  summary: KnockoutSummary | null;
}

export function KnockoutSeasonSummary({ data, summary }: Props) {
  const router = useRouter();
  const { t } = useLocale();

  const compId = data.season?.competitionId ?? data.standing?.competitionId;
  const compName = data.season?.competitionName ?? data.standing?.competitionName;

  if (!summary || summary.phases.length === 0) {
    return (
      <View className="mx-3 mt-3 rounded-2xl border border-slate-100 bg-white p-6 items-center dark:border-slate-800 dark:bg-slate-900">
        <Text className="text-sm text-slate-500 dark:text-slate-400 text-center">
          {t('team.knockout_empty') || 'Sense partits registrats en aquesta edició'}
        </Text>
      </View>
    );
  }

  const teamDisplayName = clubName(data.team.name) || data.team.shortName || data.team.name;

  return (
    <View className="space-y-3 mt-3">
      {/* Banner de Campeón o Estado de Eliminatoria */}
      <View className="mx-3 overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
        {summary.champion ? (
          <View className="bg-amber-500/10 p-4 border-b border-amber-500/20 dark:bg-amber-500/15">
            <View className="flex-row items-center gap-2">
              <Text className="text-xl">🏆</Text>
              <View className="flex-1">
                <Text className="text-xs uppercase tracking-wider font-extrabold text-amber-600 dark:text-amber-400">
                  {t('playoffs.champion') || 'Campió'}
                </Text>
                <Text numberOfLines={1} className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                  {teamDisplayName}
                </Text>
              </View>
            </View>
          </View>
        ) : summary.eliminatedIn ? (
          <View className="bg-slate-50 p-4 border-b border-slate-100 dark:bg-slate-800/40 dark:border-slate-800">
            <Text className="text-xs uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">
              {t('team.eliminated') || 'Eliminat'} · {t(`playoffs.${summary.eliminatedIn}`)}
            </Text>
          </View>
        ) : null}

        {/* Cabecera de competición */}
        <View className="p-4 flex-row items-center justify-between">
          <View className="flex-1 pr-2">
            <Text className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
              {t('team.knockout_tag') || 'Competició eliminatòria'}
            </Text>
            <Text numberOfLines={1} className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-0.5">
              {compName}
            </Text>
          </View>
          {compId ? (
            <Pressable
              onPress={() => router.push(`/competition/${compId}`)}
              hitSlop={8}
              className="active:opacity-70"
            >
              <Text className="text-xs font-semibold text-rink-passion">
                {t('team.view_competition') || 'Veure competició'} →
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Fases de la eliminatoria */}
      {summary.phases.map((phaseView, idx) => {
        const label = knockoutPhaseLabel(phaseView, t);
        return (
          <View
            key={`${phaseView.phase ?? 'custom'}-${idx}`}
            className="mx-3 overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900"
          >
            <View className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
              <Text className="text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300">
                {label}
              </Text>
            </View>
            <View className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {phaseView.series.flatMap((serie) =>
                serie.games.map((g) => (
                  <MiniMatchCard
                    key={g.id}
                    match={g as never}
                    teamId={data.team.id}
                    roundLabel={label}
                  />
                )),
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}
