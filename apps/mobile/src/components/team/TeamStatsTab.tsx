import { Text, View } from 'react-native';
import type { TeamSeasonStats } from '@/src/lib/api/types';
import { useLocale } from '@/src/i18n/LocaleContext';

interface Props {
  stats?: TeamSeasonStats | null;
}

function StatTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <View className="flex-1 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 items-center justify-center">
      <Text className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">
        {value}
      </Text>
      <Text numberOfLines={1} className="text-[10px] uppercase font-bold text-slate-400 mt-1">
        {label}
      </Text>
      {sub ? <Text className="text-[10px] text-slate-400">{sub}</Text> : null}
    </View>
  );
}

export function TeamStatsTab({ stats }: Props) {
  const { t } = useLocale();

  if (!stats || stats.played === 0) {
    return (
      <View className="mx-3 mt-3 rounded-2xl border border-slate-100 bg-white p-6 items-center dark:border-slate-800 dark:bg-slate-900">
        <Text className="text-sm text-slate-400">
          {t('team.stats_empty') || 'Sense estadístiques per a aquesta temporada'}
        </Text>
      </View>
    );
  }

  const fmtPct = (p: { total: number; scored: number; pct: number | null }) =>
    p.total > 0 ? `${p.scored}/${p.total} · ${p.pct}%` : '—';

  return (
    <View className="space-y-3 mt-3">
      {/* Balance */}
      <View className="mx-3 rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <Text className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">
          {t('team.balance') || 'Balanç'}
        </Text>
        <View className="flex-row gap-2 mb-2">
          <StatTile label={t('team.played') || 'Jugats'} value={stats.played} />
          <StatTile label={t('team.won') || 'Guanyats'} value={stats.won} />
          <StatTile label={t('team.drawn') || 'Empatats'} value={stats.drawn} />
          <StatTile label={t('team.lost') || 'Perduts'} value={stats.lost} />
        </View>
        <View className="flex-row gap-2">
          <StatTile label={t('team.goals_for') || 'GF'} value={stats.goalsFor} />
          <StatTile label={t('team.goals_against') || 'GC'} value={stats.goalsAgainst} />
          <StatTile label={t('hockey_stats.assists') || 'Assist.'} value={stats.assists} />
        </View>
      </View>

      {/* Disciplina */}
      <View className="mx-3 rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <Text className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">
          {t('team.discipline') || 'Disciplina'}
        </Text>
        <View className="flex-row gap-2">
          <StatTile label={t('hockey_stats.team_fouls') || 'Faltes'} value={stats.teamFouls} />
          <StatTile label={t('hockey_stats.blue_cards') || 'Blaves'} value={stats.blueCards} />
          <StatTile label={t('hockey_stats.red_cards') || 'Vermelles'} value={stats.redCards} />
          <StatTile label={t('hockey_stats.time_outs') || 'T. Morts'} value={stats.timeouts} />
        </View>
      </View>

      {/* Bola parada */}
      <View className="mx-3 rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <Text className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">
          {t('team.set_pieces') || 'Bola aturada'}
        </Text>
        <View className="flex-row items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800">
          <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('team.direct_fouls') || 'Faltes directes'}
          </Text>
          <Text
            className={`text-sm font-bold tabular-nums ${
              (stats.directFouls.pct ?? 0) >= 50
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-900 dark:text-slate-50'
            }`}
          >
            {fmtPct(stats.directFouls)}
          </Text>
        </View>
        <View className="flex-row items-center justify-between py-2">
          <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('team.penalties') || 'Penals'}
          </Text>
          <Text
            className={`text-sm font-bold tabular-nums ${
              (stats.penalties.pct ?? 0) >= 50
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-900 dark:text-slate-50'
            }`}
          >
            {fmtPct(stats.penalties)}
          </Text>
        </View>
      </View>
    </View>
  );
}
