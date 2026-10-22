import { useMemo } from 'react';
import { Text, View } from 'react-native';
import type { TeamDetail, TeamMatchSummary } from '@/src/lib/api/types';
import { buildKnockoutSummary, isKnockoutSeason, knockoutPhaseLabel } from '@/src/lib/knockout';
import { MiniMatchCard } from './MiniMatchCard';
import { useLocale } from '@/src/i18n/LocaleContext';

interface Props {
  data: TeamDetail;
}

export function CalendarTab({ data }: Props) {
  const { t, locale } = useLocale();
  const { matches, team, season, standing } = data;

  const koSeason = isKnockoutSeason(season, standing, matches);
  const koSummary = useMemo(
    () => (koSeason ? buildKnockoutSummary(team.id, data.knockoutMatches ?? matches) : null),
    [koSeason, team.id, data.knockoutMatches, matches],
  );

  if (matches.length === 0) {
    return (
      <View className="mx-3 mt-3 rounded-2xl border border-slate-100 bg-white p-6 items-center dark:border-slate-800 dark:bg-slate-900">
        <Text className="text-sm text-slate-400">
          {t('team.no_season_matches') || 'Sense partits per a aquesta temporada'}
        </Text>
      </View>
    );
  }

  // Agrupación por mes (anclada para consistencia)
  const groups = new Map<string, TeamMatchSummary[]>();
  for (const m of matches) {
    const date = new Date(m.scheduledAt ?? m.finishedAt ?? '');
    const key = isNaN(date.getTime())
      ? (t('team.no_date') || 'Sense data')
      : date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  return (
    <View className="space-y-3 mt-3">
      {Array.from(groups.entries()).map(([month, groupMatches]) => (
        <View
          key={month}
          className="mx-3 overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900"
        >
          <View className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
            <Text className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              {month}
            </Text>
          </View>
          <View className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {groupMatches.map((m) => {
              const phaseView = koSummary?.phaseByMatch.get(m.id);
              const roundLabel = phaseView
                ? knockoutPhaseLabel(phaseView, t)
                : m.roundName
                ? m.roundName
                : m.roundNumber
                ? `${t('competition.round') || 'Jornada'} ${m.roundNumber}`
                : null;

              return (
                <MiniMatchCard
                  key={m.id}
                  match={m}
                  teamId={team.id}
                  roundLabel={roundLabel}
                />
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}
