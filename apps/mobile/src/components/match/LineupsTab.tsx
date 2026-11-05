import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { BRAND } from '@sports/brand';
import { useLocale } from '@/src/i18n/LocaleContext';
import { Avatar, playerPhotoUri, teamLogoUri } from '@/src/components/shared/Avatar';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { StartingFiveRink } from '@/src/components/match/StartingFiveRink';
import { GoalStickIcon } from '@/src/components/shared/GoalStickIcon';
import { displayLineupName } from '@/src/lib/match-helpers';
import { clubName } from '@sports/core/names';
import type { MatchDetailRaw } from '@sports/core/api';

interface LineupsTabProps {
  lineups: MatchDetailRaw['lineups'];
  homeTeam: MatchDetailRaw['match']['homeTeam'];
  awayTeam: MatchDetailRaw['match']['awayTeam'];
}

export function LineupsTab({ lineups, homeTeam, awayTeam }: LineupsTabProps) {
  const router = useRouter();
  const { t } = useLocale();

  const homeLabel = clubName(homeTeam.name) || homeTeam.shortName || homeTeam.name;
  const awayLabel = clubName(awayTeam.name) || awayTeam.shortName || awayTeam.name;

  const homeStarters = lineups.home.filter((p) => p.isStarter);
  const awayStarters = lineups.away.filter((p) => p.isStarter);

  const hasAnyPlayers = lineups.home.length > 0 || lineups.away.length > 0;

  if (!hasAnyPlayers) {
    return (
      <View className="items-center justify-center px-6 py-12">
        <EmptyState title={t('match_detail.lineup_unavailable')} />
      </View>
    );
  }

  const teams = [
    {
      team: homeTeam,
      label: t('match_detail.local'),
      players: lineups.home,
      isHome: true,
    },
    {
      team: awayTeam,
      label: t('match_detail.visitor'),
      players: lineups.away,
      isHome: false,
    },
  ].filter(({ players }) => players.length > 0);

  const renderPlayerRow = (p: typeof lineups.home[number]) => {
    const formattedName = displayLineupName(p.playerName);
    const content = (
      <View className="flex-row items-center justify-between py-2 px-3 border-b border-slate-100 dark:border-slate-800">
        <View className="flex-row items-center gap-2.5 flex-1 pr-2">
          {/* Dorsal */}
          <View className="w-7 items-center justify-center rounded bg-slate-100 py-1 dark:bg-slate-800">
            <Text className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
              {p.jerseyNumber ?? '–'}
            </Text>
          </View>

          {/* Avatar con foto o silueta */}
          <Avatar
            uri={p.playerId ? playerPhotoUri(p.playerId, 64) : p.photoUrl}
            fallbackUri={p.photoUrl}
            name={p.playerName}
            size={32}
            variant="player"
          />

          {/* Nombre */}
          <Text
            className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex-1"
            numberOfLines={1}
          >
            {formattedName}
          </Text>
        </View>

        {/* Stats y Badges: Goles, Asistencias, 5i, C, POR */}
        <View className="flex-row items-center gap-1.5 shrink-0">
          {p.goals > 0 ? (
            <View className="flex-row items-center gap-0.5 rounded-full bg-emerald-500/10 px-2 py-0.5">
              <GoalStickIcon variant="inline" size={11} />
              <Text className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                {p.goals}
              </Text>
            </View>
          ) : null}

          {(p.assists ?? 0) > 0 ? (
            <View className="flex-row items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5">
              <Text className="font-mono text-[10px] font-black text-amber-700 dark:text-amber-400">A</Text>
              <Text className="text-xs font-bold text-amber-700 dark:text-amber-400">
                {p.assists}
              </Text>
            </View>
          ) : null}

          {p.isStarter ? (
            <View
              className="rounded px-1.5 py-0.5 items-center justify-center min-w-[22px]"
              style={{ backgroundColor: BRAND.granate }}
            >
              <Text className="text-[10px] font-bold text-white leading-none">5i</Text>
            </View>
          ) : null}

          {p.isCaptain ? (
            <View className="rounded bg-slate-700 px-1.5 py-0.5 items-center justify-center min-w-[22px] dark:bg-slate-600">
              <Text className="text-[10px] font-bold text-white leading-none">C</Text>
            </View>
          ) : null}

          {p.isGoalkeeper ? (
            <View className="rounded bg-slate-200 px-1.5 py-0.5 items-center justify-center min-w-[22px] dark:bg-slate-700">
              <Text className="text-[10px] font-bold text-slate-700 dark:text-slate-200 leading-none">
                POR
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    );

    if (p.playerId) {
      return (
        <Pressable
          key={`${p.jerseyNumber ?? ''}-${p.playerName}`}
          onPress={() => router.push(`/player/${p.playerId}`)}
          className="active:bg-slate-50 dark:active:bg-slate-800/50"
        >
          {content}
        </Pressable>
      );
    }

    return <View key={`${p.jerseyNumber ?? ''}-${p.playerName}`}>{content}</View>;
  };

  return (
    <View className="px-3 pb-8">
      {/* 1. Quinteto inicial sobre la pista de hockey */}
      {homeStarters.length > 0 || awayStarters.length > 0 ? (
        <StartingFiveRink
          home={homeStarters}
          away={awayStarters}
          homeName={homeLabel}
          awayName={awayLabel}
        />
      ) : null}

      {/* 2. Listado completo de ambos equipos */}
      {teams.map(({ team, label, players }) => (
        <View
          key={team.id}
          className="mb-4 rounded-2xl bg-white shadow-sm overflow-hidden dark:bg-slate-900 border border-slate-100 dark:border-slate-800"
        >
          {/* Cabecera del equipo */}
          <View className="flex-row items-center gap-2 p-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
            <Avatar
              uri={teamLogoUri(team.id, 64)}
              fallbackUri={team.logoUrl}
              name={team.name}
              size={24}
            />
            <Text
              className="text-sm font-bold text-slate-900 dark:text-slate-100 flex-1"
              numberOfLines={1}
            >
              {clubName(team.name) || team.shortName || team.name}
            </Text>
            <View className="rounded bg-slate-200/80 px-2 py-0.5 dark:bg-slate-700">
              <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                {label}
              </Text>
            </View>
          </View>

          {/* Leyenda de badges */}
          <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/20">
            <View className="flex-row items-center gap-1">
              <View
                className="rounded px-1 py-0.5"
                style={{ backgroundColor: BRAND.granate }}
              >
                <Text className="text-[9px] font-bold text-white">5i</Text>
              </View>
              <Text className="text-[10px] text-slate-500 dark:text-slate-400">
                {t('match_detail.starter')}
              </Text>
            </View>

            <View className="flex-row items-center gap-1">
              <View className="rounded bg-slate-700 px-1 py-0.5 dark:bg-slate-600">
                <Text className="text-[9px] font-bold text-white">C</Text>
              </View>
              <Text className="text-[10px] text-slate-500 dark:text-slate-400">
                {t('match_detail.captain')}
              </Text>
            </View>

            <View className="flex-row items-center gap-1">
              <View className="rounded bg-slate-200 px-1 py-0.5 dark:bg-slate-700">
                <Text className="text-[9px] font-bold text-slate-700 dark:text-slate-200">POR</Text>
              </View>
              <Text className="text-[10px] text-slate-500 dark:text-slate-400">
                {t('match_detail.goalkeeper')}
              </Text>
            </View>

            <View className="flex-row items-center gap-1">
              <GoalStickIcon variant="inline" size={11} />
              <Text className="text-[10px] text-slate-500 dark:text-slate-400">
                {t('hockey_stats.goals')}
              </Text>
            </View>

            <View className="flex-row items-center gap-1">
              <View className="h-3.5 w-3.5 items-center justify-center rounded bg-amber-500/15">
                <Text className="font-mono text-[9px] font-black text-amber-700 dark:text-amber-400">A</Text>
              </View>
              <Text className="text-[10px] text-slate-500 dark:text-slate-400">
                {t('hockey_stats.assists')}
              </Text>
            </View>
          </View>

          {/* Jugadores */}
          {players.map(renderPlayerRow)}
        </View>
      ))}
    </View>
  );
}
