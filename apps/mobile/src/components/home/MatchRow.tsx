import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useLocale } from '@/src/i18n/LocaleContext';
import { formatKickoff, isEffectivelyLive } from '@/src/lib/time';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { clubName } from '@sports/core/names';
import type { MatchSummary } from '@sports/core/api';

interface MatchRowProps {
  match: MatchSummary;
  showCompetition?: boolean;
}

export function MatchRow({ match, showCompetition = false }: MatchRowProps) {
  const router = useRouter();
  const { t } = useLocale();

  const live = isEffectivelyLive(match.status, match.scheduledAt);
  const isFinished = match.status === 'finished';
  const showScore = live || isFinished;

  const homeName = clubName(match.homeTeam.name) || match.homeTeam.shortName || match.homeTeam.name;
  const awayName = clubName(match.awayTeam.name) || match.awayTeam.shortName || match.awayTeam.name;

  const stateLabel = live
    ? `${t('match_states.live')}, ${match.score.home ?? 0} a ${match.score.away ?? 0}`
    : isFinished
    ? `${t('match_states.final')}, ${match.score.home ?? 0} a ${match.score.away ?? 0}`
    : `${formatKickoff(match.scheduledAt)}`;

  const a11yLabel = `${homeName} contra ${awayName}, ${stateLabel}${
    showCompetition && match.competitionName ? `, ${match.competitionName}` : ''
  }`;

  return (
    <Pressable
      onPress={() => router.push(`/match/${match.id}`)}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={t('a11y.open_match_detail') || 'Abre el detalle del partido'}
      className="px-3.5 py-3 active:bg-slate-50 dark:active:bg-slate-800/60"
    >
      {showCompetition && match.competitionName ? (
        <Text
          numberOfLines={1}
          className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400"
        >
          {match.competitionName}
        </Text>
      ) : null}

      <View className="flex-row items-center justify-between">
        {/* Local: Escudo + Nombre */}
        <View className="flex-1 flex-row items-center gap-2.5 pr-2">
          <Avatar
            uri={teamLogoUri(match.homeTeam.id, 64)}
            fallbackUri={match.homeTeam.logoUrl}
            name={homeName}
            size={24}
          />
          <Text
            className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-100"
            numberOfLines={2}
          >
            {homeName}
          </Text>
        </View>

        {/* Centro: Marcador o Kickoff */}
        <View className="items-center px-1 min-w-[76px]">
          {showScore ? (
            <View className="items-center">
              <Text className="font-mono text-base font-extrabold tabular-nums text-slate-900 dark:text-slate-50">
                {match.score.home ?? 0} - {match.score.away ?? 0}
              </Text>
              {live ? (
                <>
                  <View className="mt-0.5 flex-row items-center gap-1 rounded-full bg-live-deep px-1.5 py-0.2">
                    <View className="h-1.5 w-1.5 rounded-full bg-white" />
                    <Text className="text-[9px] font-black uppercase text-white">
                      {t('match_states.live')}
                    </Text>
                  </View>
                  {match.fouls && (match.fouls.home != null || match.fouls.away != null) ? (() => {
                    const hf = match.fouls.home ?? 0;
                    const af = match.fouls.away ?? 0;
                    const hasBonus = hf >= 10 || af >= 10;
                    const hasWarning = hf === 9 || af === 9 || hf === 14 || af === 14;

                    return (
                      <View className="mt-0.5 flex-row items-center gap-1">
                        <Text
                          className={`font-mono text-[10px] tabular-nums ${
                            hasBonus
                              ? 'text-rose-600 dark:text-rose-400 font-extrabold'
                              : hasWarning
                              ? 'text-amber-600 dark:text-amber-400 font-bold'
                              : 'text-slate-500 dark:text-slate-400 font-bold'
                          }`}
                          accessibilityLabel={`Faltas: ${hf} a ${af}${hasBonus ? ', en bonus de falta directa' : ''}`}
                        >
                          F: {hf} - {af}
                        </Text>
                        {hasBonus ? (
                          <View className="rounded bg-rose-100 px-1 py-0.2 dark:bg-rose-950/70">
                            <Text className="text-[8px] font-black uppercase text-rose-700 dark:text-rose-300">
                              Directa
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    );
                  })() : null}
                </>
              ) : (
                <Text className="text-[10px] font-semibold text-slate-400 dark:text-slate-400">
                  {t('match_states.final')}
                </Text>
              )}
            </View>
          ) : (
            <View className="rounded-lg bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
              <Text className="font-mono text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">
                {formatKickoff(match.scheduledAt)}
              </Text>
            </View>
          )}
        </View>

        {/* Visitante: Nombre + Escudo */}
        <View className="flex-1 flex-row items-center justify-end gap-2.5 pl-2">
          <Text
            className="flex-1 text-right text-sm font-medium text-slate-800 dark:text-slate-100"
            numberOfLines={2}
          >
            {awayName}
          </Text>
          <Avatar
            uri={teamLogoUri(match.awayTeam.id, 64)}
            fallbackUri={match.awayTeam.logoUrl}
            name={awayName}
            size={24}
          />
        </View>
      </View>
    </Pressable>
  );
}
