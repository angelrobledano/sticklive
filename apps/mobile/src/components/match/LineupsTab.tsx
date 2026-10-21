import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { BRAND } from '@sports/brand';
import { useLocale } from '@/src/i18n/LocaleContext';
import { Avatar, playerPhotoUri } from '@/src/components/shared/Avatar';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { displayLineupName } from '@/src/lib/match-helpers';
import type { MatchDetail } from '@/src/lib/api/types';

interface LineupsTabProps {
  lineups: MatchDetail['lineups'];
  homeTeam: MatchDetail['match']['homeTeam'];
  awayTeam: MatchDetail['match']['awayTeam'];
}

type TeamSide = 'home' | 'away';

export function LineupsTab({ lineups, homeTeam, awayTeam }: LineupsTabProps) {
  const router = useRouter();
  const { t } = useLocale();
  const [activeSide, setActiveSide] = useState<TeamSide>('home');

  const activePlayers = activeSide === 'home' ? lineups.home : lineups.away;
  const starters = activePlayers.filter((p) => p.isStarter);
  const bench = activePlayers.filter((p) => !p.isStarter);

  if (activePlayers.length === 0) {
    return (
      <View className="items-center justify-center px-6 py-12">
        <EmptyState title={t('match_detail.lineup_unavailable')} />
      </View>
    );
  }

  const renderPlayer = (p: typeof activePlayers[number]) => {
    const formattedName = displayLineupName(p.playerName);
    const content = (
      <View className="flex-row items-center justify-between py-2.5 px-3 border-b border-slate-100 dark:border-slate-800">
        <View className="flex-row items-center gap-2.5 flex-1 pr-2">
          {/* Avatar con foto o iniciales */}
          <Avatar
            uri={p.playerId ? playerPhotoUri(p.playerId, 64) : p.photoUrl}
            name={p.playerName}
            size={36}
          />

          {/* Dorsal */}
          <View className="min-w-[24px] items-center justify-center rounded bg-slate-200 px-1.5 py-0.5 dark:bg-slate-700">
            <Text className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
              {p.jerseyNumber ?? '–'}
            </Text>
          </View>

          {/* Nombre */}
          <Text
            className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex-1"
            numberOfLines={1}
          >
            {formattedName}
          </Text>
        </View>

        {/* Badges: 5i, C, POR, Goles */}
        <View className="flex-row items-center gap-1.5 shrink-0">
          {p.goals > 0 ? (
            <View className="flex-row items-center gap-0.5 rounded-full bg-emerald-500/10 px-2 py-0.5">
              <Text className="text-[10px]">🏑</Text>
              <Text className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                {p.goals}
              </Text>
            </View>
          ) : null}

          {p.isStarter ? (
            <View
              className="rounded px-1.5 py-0.5"
              style={{ backgroundColor: BRAND.granate }}
            >
              <Text className="text-[10px] font-bold text-white">5i</Text>
            </View>
          ) : null}

          {p.isCaptain ? (
            <View className="rounded bg-slate-700 px-1.5 py-0.5 dark:bg-slate-600">
              <Text className="text-[10px] font-bold text-white">C</Text>
            </View>
          ) : null}

          {p.isGoalkeeper ? (
            <View className="rounded bg-slate-200 px-1.5 py-0.5 dark:bg-slate-700">
              <Text className="text-[10px] font-bold text-slate-700 dark:text-slate-200">
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
      {/* Selector de equipo Local / Visitante */}
      <View className="flex-row rounded-xl bg-slate-200/70 p-1 mb-3 dark:bg-slate-800">
        <Pressable
          onPress={() => setActiveSide('home')}
          className={`flex-1 items-center justify-center rounded-lg py-2 ${
            activeSide === 'home'
              ? 'bg-white shadow-sm dark:bg-slate-900'
              : 'active:opacity-70'
          }`}
        >
          <Text
            className={`text-xs font-bold ${
              activeSide === 'home'
                ? 'text-slate-900 dark:text-slate-100'
                : 'text-slate-500 dark:text-slate-400'
            }`}
            numberOfLines={1}
          >
            {homeTeam.shortName ?? homeTeam.name}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setActiveSide('away')}
          className={`flex-1 items-center justify-center rounded-lg py-2 ${
            activeSide === 'away'
              ? 'bg-white shadow-sm dark:bg-slate-900'
              : 'active:opacity-70'
          }`}
        >
          <Text
            className={`text-xs font-bold ${
              activeSide === 'away'
                ? 'text-slate-900 dark:text-slate-100'
                : 'text-slate-500 dark:text-slate-400'
            }`}
            numberOfLines={1}
          >
            {awayTeam.shortName ?? awayTeam.name}
          </Text>
        </Pressable>
      </View>

      {/* 5 Inicial */}
      {starters.length > 0 ? (
        <View className="mb-4 rounded-2xl bg-white shadow-sm overflow-hidden dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
          <View className="bg-slate-50 px-4 py-2 border-b border-slate-100 dark:bg-slate-800/60 dark:border-slate-800">
            <Text className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('match_detail.starter')} (5 Inicial)
            </Text>
          </View>
          {starters.map(renderPlayer)}
        </View>
      ) : null}

      {/* Suplentes */}
      {bench.length > 0 ? (
        <View className="rounded-2xl bg-white shadow-sm overflow-hidden dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
          <View className="bg-slate-50 px-4 py-2 border-b border-slate-100 dark:bg-slate-800/60 dark:border-slate-800">
            <Text className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Banquillo
            </Text>
          </View>
          {bench.map(renderPlayer)}
        </View>
      ) : null}
    </View>
  );
}
