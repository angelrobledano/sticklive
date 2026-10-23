import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { TeamDetail } from '@/src/lib/api/types';
import { Avatar, playerPhotoUri } from '@/src/components/shared/Avatar';
import { playerDisplayName } from '@/src/lib/names';
import { STAFF_ROLE_LABELS, staffDisplayName } from '@/src/lib/team-section';
import { goalsWord } from '@/src/lib/squad-helpers';
import { useLocale } from '@/src/i18n/LocaleContext';

interface Props {
  data: TeamDetail;
}

type SquadPlayer = TeamDetail['squad'][number];

export function SquadTab({ data }: Props) {
  const router = useRouter();
  const { t, locale } = useLocale();
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
  const hasAnyCards = squad.some(
    (p) => (p.blueCards && p.blueCards > 0) || (p.redCards && p.redCards > 0),
  );

  const renderPlayer = (p: SquadPlayer) => {
    const hasStats =
      p.goals > 0 ||
      (p.blueCards != null && p.blueCards > 0) ||
      (p.redCards != null && p.redCards > 0);

    const goalLabel = p.goals > 0 ? `${p.goals} ${goalsWord(p.goals, locale)}` : '';
    const blueCardLabel =
      p.blueCards && p.blueCards > 0
        ? `${p.blueCards} ${t('hockey_stats.blue_cards') || 'tarjetas azules'}`
        : '';
    const redCardLabel =
      p.redCards && p.redCards > 0
        ? `${p.redCards} ${t('hockey_stats.red_cards') || 'tarjetas rojas'}`
        : '';

    const statsDescription = [goalLabel, blueCardLabel, redCardLabel].filter(Boolean).join(', ');

    return (
      <Pressable
        key={p.playerId}
        onPress={() => router.push(`/player/${p.playerId}`)}
        accessibilityRole="button"
        accessibilityLabel={`${playerDisplayName(p.firstName, p.lastName)}, dorsal ${p.jerseyNumber ?? '–'}, ${t(p.isGoalkeeper ? 'team.gk_pos' : 'team.player_pos')}${statsDescription ? `, ${statsDescription}` : ''}`}
        className="min-h-[48px] flex-row items-center gap-3 px-4 py-3 active:bg-slate-50 dark:active:bg-slate-800/60"
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
        <View className="flex-1 min-w-0 pr-2">
          <Text numberOfLines={1} className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {playerDisplayName(p.firstName, p.lastName)}
          </Text>
          <Text className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {t(p.isGoalkeeper ? 'team.gk_pos' : 'team.player_pos')}
          </Text>
        </View>

        {/* Estadísticas del jugador: Goles y Tarjetas visuales */}
        {hasStats ? (
          <View className="flex-row items-center gap-1.5 shrink-0">
            {p.goals > 0 ? (
              <View className="flex-row items-center gap-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/70 dark:border-emerald-800/50 px-2 py-0.5">
                <Text className="text-xs font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">
                  {p.goals}
                </Text>
                <Text className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  {goalsWord(p.goals, locale)}
                </Text>
              </View>
            ) : null}

            {p.blueCards && p.blueCards > 0 ? (
              <View
                className="flex-row items-center gap-1.5 rounded-md bg-blue-50 dark:bg-blue-950/40 border border-blue-200/70 dark:border-blue-800/50 px-2 py-0.5"
                accessibilityLabel={`${p.blueCards} ${t('hockey_stats.blue_cards') || 'tarjetas azules'}`}
              >
                <View className="w-2.5 h-3.5 rounded-[2px] bg-blue-500 shadow-2xs" />
                <Text className="text-xs font-bold text-blue-700 dark:text-blue-300 tabular-nums">
                  {p.blueCards}
                </Text>
              </View>
            ) : null}

            {p.redCards && p.redCards > 0 ? (
              <View
                className="flex-row items-center gap-1.5 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200/70 dark:border-red-800/50 px-2 py-0.5"
                accessibilityLabel={`${p.redCards} ${t('hockey_stats.red_cards') || 'tarjetas rojas'}`}
              >
                <View className="w-2.5 h-3.5 rounded-[2px] bg-red-500 shadow-2xs" />
                <Text className="text-xs font-bold text-red-700 dark:text-red-300 tabular-nums">
                  {p.redCards}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
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
              {locale === 'ca' ? 'Porters' : locale === 'en' ? 'Goalkeepers' : 'Porteros'}
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
              {t('team.players') || (locale === 'ca' ? 'Jugadors' : 'Jugadores')}
            </Text>
          </View>
          <View className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {outfield.map(renderPlayer)}
          </View>
        </View>
      ) : null}

      {/* Leyenda de tarjetas */}
      {hasAnyCards ? (
        <View className="mx-3 flex-row items-center justify-center gap-4 py-2">
          <View className="flex-row items-center gap-1.5">
            <View className="w-2.5 h-3.5 rounded-[2px] bg-blue-500 shadow-2xs" />
            <Text className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {t('timeline_events.blue_card') || 'Tarjeta azul'}
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="w-2.5 h-3.5 rounded-[2px] bg-red-500 shadow-2xs" />
            <Text className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {t('timeline_events.red_card') || 'Tarjeta roja'}
            </Text>
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
