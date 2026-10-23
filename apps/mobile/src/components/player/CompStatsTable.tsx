import { Text, View } from 'react-native';
import type { PlayerCompStats } from '@/src/lib/api/types';
import { useLocale } from '@/src/i18n/LocaleContext';

interface Props {
  rows: PlayerCompStats[];
}

export function CompStatsTable({ rows }: Props) {
  const { t } = useLocale();

  if (!rows || rows.length === 0) return null;

  return (
    <View className="mx-3 mt-3 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <View className="border-b border-slate-100 px-3 py-2 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/40">
        <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {t('player.breakdown')}
        </Text>
      </View>

      {/* Cabecera */}
      <View className="flex-row items-center border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <Text className="flex-1 text-[11px] font-bold uppercase text-slate-500 dark:text-slate-400">
          {t('player.competition') || 'Competición'}
        </Text>
        <Text className="w-8 text-center text-[11px] font-bold text-slate-400">
          {t('player.col_pj') || 'PJ'}
        </Text>
        <Text className="w-8 text-center text-[11px] font-bold text-slate-400">
          {t('player.col_g') || 'G'}
        </Text>
        <View className="w-8 items-center justify-center" accessibilityLabel={t('hockey_stats.blue_cards') || 'Tarjetas azules'}>
          <View className="w-2.5 h-3.5 rounded-[2px] bg-blue-500 shadow-2xs" />
        </View>
        <View className="w-8 items-center justify-center" accessibilityLabel={t('hockey_stats.red_cards') || 'Tarjetas rojas'}>
          <View className="w-2.5 h-3.5 rounded-[2px] bg-red-500 shadow-2xs" />
        </View>
        <Text className="w-10 text-center text-[11px] font-bold text-slate-400">
          {t('player.col_pe') || 'Pen'}
        </Text>
      </View>

      {/* Filas */}
      {rows.map((r) => {
        const penStr =
          r.penaltiesTotal > 0 ? `${r.penaltiesScored}/${r.penaltiesTotal}` : '—';

        return (
          <View
            key={r.competitionId}
            className="flex-row items-center border-b border-slate-100 px-3 py-2.5 dark:border-slate-800"
          >
            <View className="flex-1 min-w-0 pr-2">
              <Text
                numberOfLines={1}
                className="text-xs font-semibold text-slate-800 dark:text-slate-200"
              >
                {r.competitionShort ?? r.competitionName}
              </Text>
            </View>

            <Text className="w-8 text-center font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300">
              {r.pj}
            </Text>
            <Text
              className={`w-8 text-center font-mono text-xs tabular-nums font-bold ${
                r.goals > 0 ? 'text-rink-passion' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {r.goals > 0 ? r.goals : '—'}
            </Text>
            <Text
              className={`w-8 text-center font-mono text-xs tabular-nums ${
                r.blueCards > 0
                  ? 'text-blue-500 dark:text-blue-400 font-semibold'
                  : 'text-slate-400'
              }`}
            >
              {r.blueCards > 0 ? r.blueCards : '—'}
            </Text>
            <Text
              className={`w-8 text-center font-mono text-xs tabular-nums ${
                r.redCards > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-slate-400'
              }`}
            >
              {r.redCards > 0 ? r.redCards : '—'}
            </Text>
            <Text className="w-10 text-center font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              {penStr}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
