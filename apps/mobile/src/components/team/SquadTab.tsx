import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { TeamDetail } from '@/src/lib/api/types';
import { Avatar, playerPhotoUri } from '@/src/components/shared/Avatar';
import { GoalStickIcon } from '@/src/components/shared/GoalStickIcon';
import { playerDisplayName } from '@/src/lib/names';
import { STAFF_ROLE_LABELS, staffDisplayName } from '@/src/lib/team-section';
import { useLocale } from '@/src/i18n/LocaleContext';

interface Props {
  data: TeamDetail;
}

export function SquadTab({ data }: Props) {
  const router = useRouter();
  const { t } = useLocale();
  const { squad, staff } = data;

  if (squad.length === 0) {
    return (
      <View className="mx-3 mt-3 rounded-2xl border border-slate-100 bg-white p-6 items-center dark:border-slate-800 dark:bg-slate-900">
        <Text className="text-sm text-slate-400">
          {t('team.squad_empty') || 'Sense plantilla per a aquesta temporada'}
        </Text>
      </View>
    );
  }

  const goalkeepers = squad.filter((p) => p.isGoalkeeper);
  const outfield = squad.filter((p) => !p.isGoalkeeper);

  const renderPlayer = (p: (typeof squad)[0]) => {
    const hasStats = (p.goals > 0) || (p.blueCards != null && p.blueCards > 0) || (p.redCards != null && p.redCards > 0);

    return (
      <Pressable
        key={p.playerId}
        onPress={() => router.push(`/player/${p.playerId}`)}
        className="flex-row items-center gap-3 px-4 py-3 active:bg-slate-50 dark:active:bg-slate-800/60"
      >
        {/* Dorsal */}
        <Text className="w-6 text-center font-mono text-xs font-bold text-slate-400">
          {p.jerseyNumber != null ? p.jerseyNumber : '—'}
        </Text>

        {/* Avatar */}
        <Avatar
          uri={playerPhotoUri(p.playerId, 64)}
          fallbackUri={p.photoUrl}
          name={`${p.firstName} ${p.lastName}`}
          size={32}
          variant="player"
        />

        {/* Nombre y posición */}
        <View className="flex-1 min-w-0">
          <Text numberOfLines={1} className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {playerDisplayName(p.firstName, p.lastName)}
          </Text>
          <Text className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {t(p.isGoalkeeper ? 'team.gk_pos' : 'team.player_pos')}
          </Text>
        </View>

        {/* Badge portero */}
        {p.isGoalkeeper ? (
          <View className="rounded bg-slate-100 px-1.5 py-0.5 border border-slate-200 dark:bg-slate-800 dark:border-slate-700">
            <Text className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
              {t('team.gk_short') || 'PO'}
            </Text>
          </View>
        ) : null}

        {/* Estadísticas del jugador */}
        {hasStats ? (
          <View className="flex-row items-center gap-2 px-1">
            {p.goals > 0 ? (
              <View className="flex-row items-center gap-1">
                <Text className="font-bold text-xs text-slate-800 dark:text-slate-200">{p.goals}</Text>
                <GoalStickIcon variant="inline" size={11} />
              </View>
            ) : null}
            {p.blueCards && p.blueCards > 0 ? (
              <View className="items-center">
                <Text className="font-bold text-xs text-blue-600 dark:text-blue-400">{p.blueCards}</Text>
                <Text className="text-[9px] text-slate-400">{t('player.col_az') || 'Az'}</Text>
              </View>
            ) : null}
            {p.redCards && p.redCards > 0 ? (
              <View className="items-center">
                <Text className="font-bold text-xs text-red-600 dark:text-red-400">{p.redCards}</Text>
                <Text className="text-[9px] text-slate-400">{t('player.col_rj') || 'Rj'}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <Text className="text-slate-400">›</Text>
      </Pressable>
    );
  };

  return (
    <View className="space-y-3 mt-3">
      {/* Porteros */}
      {goalkeepers.length > 0 ? (
        <View className="mx-3 overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <View className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
            <Text className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              {t('team.gk_pos') || 'Porters'}
            </Text>
          </View>
          <View className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {goalkeepers.map(renderPlayer)}
          </View>
        </View>
      ) : null}

      {/* Jugadores de campo */}
      {outfield.length > 0 ? (
        <View className="mx-3 overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <View className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
            <Text className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              {t('team.players') || 'Jugadors de camp'}
            </Text>
          </View>
          <View className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {outfield.map(renderPlayer)}
          </View>
        </View>
      ) : null}

      {/* Cuerpo técnico */}
      {staff && staff.length > 0 ? (
        <View className="mx-3 overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <View className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
            <Text className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              {t('team.staff') || 'Cos tècnic'}
            </Text>
          </View>
          <View className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {staff.map((s, idx) => (
              <View key={`${s.role}-${idx}`} className="flex-row items-center gap-3 px-4 py-3">
                <View className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 items-center justify-center">
                  <Text className="text-sm text-slate-500">👤</Text>
                </View>
                <Text numberOfLines={1} className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {staffDisplayName(s.name)}
                </Text>
                <View className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                  <Text className="text-xs text-slate-600 dark:text-slate-400">
                    {STAFF_ROLE_LABELS[s.role] ? t(STAFF_ROLE_LABELS[s.role]!) : s.role}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
