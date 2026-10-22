import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { TeamMatchSummary } from '@/src/lib/api/types';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { useLocale } from '@/src/i18n/LocaleContext';
import { formatDayLabel, formatKickoff, isEffectivelyLive } from '@/src/lib/time';

interface Props {
  match: TeamMatchSummary;
  teamId: string;
  roundLabel?: string | null;
}

export function MiniMatchCard({ match, teamId, roundLabel }: Props) {
  const router = useRouter();
  const { t, locale } = useLocale();

  const isHome = match.homeTeam.id === teamId;
  const opp = isHome ? match.awayTeam : match.homeTeam;
  const isFinished = match.status === 'finished';
  const isLive = isEffectivelyLive(match.status, match.scheduledAt);
  const showScore = isFinished || isLive;

  const myScore = isHome ? match.score.home : match.score.away;
  const oppScore = isHome ? match.score.away : match.score.home;
  const won = showScore && myScore !== null && oppScore !== null && myScore > oppScore;
  const drew = showScore && myScore !== null && oppScore !== null && myScore === oppScore;

  const dateLabel = formatDayLabel(match.scheduledAt ?? match.finishedAt ?? null, locale);

  const resultColor = !showScore
    ? 'bg-slate-300 dark:bg-slate-700'
    : won
    ? 'bg-emerald-500'
    : drew
    ? 'bg-slate-400'
    : 'bg-red-500';

  return (
    <Pressable
      onPress={() => router.push(`/match/${match.id}`)}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-slate-50 dark:active:bg-slate-800/60"
    >
      {/* Indicador de resultado lateral */}
      <View className={`w-1.5 self-stretch rounded-full ${resultColor}`} />

      {/* Escudo del rival */}
      <Avatar
        uri={teamLogoUri(opp.id, 64)}
        fallbackUri={opp.logoUrl}
        name={opp.name}
        size={30}
      />

      {/* Nombre y fecha / jornada */}
      <View className="flex-1 min-w-0">
        <Text numberOfLines={1} className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {isHome ? 'vs' : '@'} {opp.shortName ?? opp.name}
        </Text>
        <Text numberOfLines={1} className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {roundLabel ? <Text className="font-semibold text-slate-700 dark:text-slate-300">{roundLabel} · </Text> : null}
          {isLive ? (
            <Text className="font-bold text-live-deep dark:text-live">{t('match_states.live')}</Text>
          ) : (
            dateLabel || ''
          )}
        </Text>
      </View>

      {/* Marcador o kickoff */}
      <View className="shrink-0 items-end">
        {showScore ? (
          <Text className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">
            {myScore ?? 0} – {oppScore ?? 0}
          </Text>
        ) : (
          <Text className="font-mono text-sm font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
            {formatKickoff(match.scheduledAt)}
          </Text>
        )}
      </View>
    </Pressable>
  );
}
