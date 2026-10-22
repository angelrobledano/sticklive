import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { TeamMatchSummary } from '@/src/lib/api/types';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { useLocale } from '@/src/i18n/LocaleContext';
import { formatDayLabel, formatKickoff, isEffectivelyLive } from '@/src/lib/time';
import { clubName } from '@/src/lib/names';
import { teamResult, type TeamResult } from '@/src/lib/team-calendar';

interface Props {
  match: TeamMatchSummary;
  teamId: string;
  roundLabel?: string | null;
}

const RESULT_STYLE: Record<TeamResult, { bg: string; text: string }> = {
  W: { bg: 'bg-emerald-600', text: 'text-white' },
  D: { bg: 'bg-slate-400 dark:bg-slate-500', text: 'text-white' },
  L: { bg: 'bg-rink-passion', text: 'text-white' },
};

export function MiniMatchCard({ match, teamId, roundLabel }: Props) {
  const router = useRouter();
  const { t, locale } = useLocale();

  const isLive = isEffectivelyLive(match.status, match.scheduledAt);
  const isFinished = match.status === 'finished';
  const showScore = isFinished || isLive;
  const result = teamResult(teamId, match);

  const dateLabel = formatDayLabel(match.scheduledAt ?? match.finishedAt ?? null, locale);
  const kickoff = formatKickoff(match.scheduledAt);

  const renderTeamRow = (team: TeamMatchSummary['homeTeam'], score: number | null) => {
    const isMe = team.id === teamId;
    return (
      <View className="flex-row items-center gap-2 py-0.5">
        <Avatar
          uri={teamLogoUri(team.id, 48)}
          fallbackUri={team.logoUrl}
          name={team.name}
          size={18}
        />
        <Text
          numberOfLines={1}
          className={`flex-1 text-xs ${
            isMe
              ? 'font-bold text-slate-900 dark:text-slate-50'
              : 'font-medium text-slate-600 dark:text-slate-300'
          }`}
        >
          {clubName(team.name) || team.shortName || team.name}
        </Text>
        {showScore && (
          <Text
            className={`font-mono text-sm tabular-nums ${
              isMe
                ? 'font-bold text-slate-900 dark:text-slate-50'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {score ?? 0}
          </Text>
        )}
      </View>
    );
  };

  return (
    <Pressable
      onPress={() => router.push(`/match/${match.id}`)}
      accessibilityRole="button"
      className="border-b border-slate-100 px-4 py-2.5 active:bg-slate-50 dark:border-slate-800 dark:active:bg-slate-800/60"
    >
      {/* Cabecera de la tarjeta: jornada / fecha y badge de estado */}
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
          {roundLabel ? <Text className="font-bold text-slate-700 dark:text-slate-300">{roundLabel} · </Text> : null}
          {dateLabel}
          {!showScore && kickoff ? ` · ${kickoff}` : ''}
        </Text>

        {isLive ? (
          <View className="flex-row items-center gap-1 rounded-full bg-live/15 px-2 py-0.5">
            <View className="h-1.5 w-1.5 rounded-full bg-live animate-pulse" />
            <Text className="text-[10px] font-bold uppercase tracking-wider text-live-deep dark:text-live">
              {t('match_states.live') || 'Directo'}
            </Text>
          </View>
        ) : result && isFinished ? (
          <View
            className={`h-4 min-w-[18px] items-center justify-center rounded px-1 ${
              RESULT_STYLE[result]?.bg ?? 'bg-slate-300'
            }`}
          >
            <Text className="font-mono text-[10px] font-bold text-white">
              {t(`team_calendar.res_${result}`) || result}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Los dos equipos (local arriba, visitante abajo) */}
      <View className="space-y-0.5">
        {renderTeamRow(match.homeTeam, match.score.home)}
        {renderTeamRow(match.awayTeam, match.score.away)}
      </View>
    </Pressable>
  );
}
