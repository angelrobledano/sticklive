import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Avatar } from '@/src/components/shared/Avatar';
import { clubName, playerDisplayName, playerNameFromRaw } from '@/src/lib/names';
import type { SeasonLeader, SeasonStats } from '@/src/lib/api/types';
import { useLocale } from '@/src/i18n/LocaleContext';

const LEADERBOARD_PREVIEW = 5;

function leaderDisplayName(l: SeasonLeader): string {
  return l.firstName && l.lastName
    ? playerDisplayName(l.firstName, l.lastName)
    : playerNameFromRaw(l.playerName);
}

function LeaderBoard({
  title,
  leaders,
  valueLabel,
  extraLabel,
}: {
  title: string;
  leaders: SeasonLeader[];
  valueLabel: string;
  extraLabel?: string;
}) {
  const router = useRouter();
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);

  if (!leaders || leaders.length === 0) return null;

  const visible = expanded ? leaders : leaders.slice(0, LEADERBOARD_PREVIEW);
  const hiddenCount = leaders.length - LEADERBOARD_PREVIEW;

  const showMoreText = (t('common.show_more') || 'Mostrar más ({n})').replace('{n}', String(hiddenCount));
  const showLessText = t('common.show_less') || 'Mostrar menos';

  return (
    <View className="mb-3 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
      {/* Cabecera */}
      <View className="flex-row items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
        <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {title}
        </Text>
        <Text className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {valueLabel}
          {extraLabel ? ` / ${extraLabel}` : ''}
        </Text>
      </View>

      {/* Filas */}
      <View className="divide-y divide-slate-100 dark:divide-slate-800/60">
        {visible.map((l, idx) => {
          const name = leaderDisplayName(l);
          return (
            <Pressable
              key={`${l.playerId ?? l.playerName}-${idx}`}
              onPress={() => (l.playerId ? router.push(`/player/${l.playerId}`) : null)}
              className="flex-row items-center gap-2.5 px-3.5 py-2.5 active:opacity-70"
            >
              <Text className="w-5 text-center font-mono text-xs font-semibold text-slate-400">
                {idx + 1}
              </Text>
              <Avatar uri={l.photoUrl} name={name} size={30} variant="player" />
              <View className="flex-1 min-w-0 pr-2">
                <Text
                  numberOfLines={1}
                  className="text-sm font-semibold text-slate-800 dark:text-slate-100"
                >
                  {name}
                </Text>
                <Text
                  numberOfLines={1}
                  className="text-[10px] font-medium text-slate-500 dark:text-slate-400"
                >
                  {clubName(l.teamName ?? l.teamShort ?? '')}
                </Text>
              </View>
              <Text className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-50">
                {l.value}
              </Text>
              {extraLabel ? (
                <Text className="w-6 text-right font-mono text-xs tabular-nums text-slate-400">
                  {l.extra}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {/* Botón Ver más / Ver menos */}
      {hiddenCount > 0 ? (
        <Pressable
          onPress={() => setExpanded((e) => !e)}
          className="border-t border-slate-100 py-3 active:opacity-70 dark:border-slate-800"
        >
          <Text className="text-center text-xs font-bold text-rink-passion dark:text-rink-accent">
            {expanded ? showLessText : showMoreText}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function StatsLeadersTab({ stats }: { stats: SeasonStats | null | undefined }) {
  if (!stats) return null;

  const empty =
    (stats.topScorers?.length ?? 0) === 0 &&
    (stats.topAssists?.length ?? 0) === 0 &&
    (stats.topCards?.length ?? 0) === 0;

  if (empty) {
    return (
      <View className="mx-3 mt-4 items-center justify-center rounded-xl bg-white p-8 dark:bg-slate-900">
        <Text className="text-xs text-slate-500 dark:text-slate-400">
          No hay estadísticas disponibles para esta temporada
        </Text>
      </View>
    );
  }

  return (
    <View className="px-3 pt-3">
      <LeaderBoard
        title="Goleadores"
        leaders={stats.topScorers}
        valueLabel="Goles"
        extraLabel="Asist."
      />
      <LeaderBoard
        title="Asistentes"
        leaders={stats.topAssists}
        valueLabel="Asist."
        extraLabel="Goles"
      />
      <LeaderBoard
        title="Tarjetas"
        leaders={stats.topCards}
        valueLabel="Azul"
        extraLabel="Roja"
      />
    </View>
  );
}
