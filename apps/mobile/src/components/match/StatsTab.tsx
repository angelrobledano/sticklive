import { Text, View } from 'react-native';
import { BRAND } from '@sports/brand';
import { useLocale } from '@/src/i18n/LocaleContext';
import { EmptyState } from '@/src/components/shared/EmptyState';
import type { MatchDetail } from '@/src/lib/api/types';

interface StatsTabProps {
  data: MatchDetail;
}

interface StatRowProps {
  label: string;
  home: number | string;
  away: number | string;
  homeNum?: number;
  awayNum?: number;
}

function StatRow({ label, home, away, homeNum = 0, awayNum = 0 }: StatRowProps) {
  const total = homeNum + awayNum;
  const safeTotal = total > 0 ? total : 1;
  const homePct = total > 0 ? Math.round((homeNum / safeTotal) * 100) : 50;
  const awayPct = total > 0 ? Math.round((awayNum / safeTotal) * 100) : 50;

  return (
    <View className="my-2.5">
      <Text className="text-center text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
        {label}
      </Text>
      <View className="flex-row items-center gap-3">
        {/* Valor Local */}
        <Text className="w-10 text-right font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
          {home}
        </Text>

        {/* Barras enfrentadas */}
        <View className="flex-1 flex-row h-2 items-center gap-1">
          {/* Barra Local */}
          <View className="flex-1 flex-row justify-end h-full rounded-l-full bg-slate-100 overflow-hidden dark:bg-slate-800">
            <View
              className="h-full rounded-l-full"
              style={{
                width: `${homePct}%`,
                backgroundColor: BRAND.granate,
              }}
            />
          </View>

          {/* Barra Visitante */}
          <View className="flex-1 h-full rounded-r-full bg-slate-100 overflow-hidden dark:bg-slate-800">
            <View
              className="h-full rounded-r-full bg-slate-500 dark:bg-slate-400"
              style={{
                width: `${awayPct}%`,
              }}
            />
          </View>
        </View>

        {/* Valor Visitante */}
        <Text className="w-10 text-left font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
          {away}
        </Text>
      </View>
    </View>
  );
}

export function StatsTab({ data }: StatsTabProps) {
  const { t } = useLocale();
  const { stats, match } = data;

  const hasAnyStats =
    stats &&
    (stats.homeFouls > 0 ||
      stats.awayFouls > 0 ||
      (stats.homeGoals ?? 0) > 0 ||
      (stats.awayGoals ?? 0) > 0 ||
      (stats.homeBlueCards ?? 0) > 0 ||
      (stats.awayBlueCards ?? 0) > 0 ||
      (stats.homeRedCards ?? 0) > 0 ||
      (stats.awayRedCards ?? 0) > 0 ||
      (stats.homeTimeouts ?? 0) > 0 ||
      (stats.awayTimeouts ?? 0) > 0 ||
      (stats.homeDirectFouls?.total ?? 0) > 0 ||
      (stats.awayDirectFouls?.total ?? 0) > 0 ||
      (stats.homePenalties?.total ?? 0) > 0 ||
      (stats.awayPenalties?.total ?? 0) > 0);

  if (!hasAnyStats) {
    return (
      <View className="items-center justify-center px-6 py-12">
        <EmptyState
          title={
            match.status === 'scheduled'
              ? t('match_detail.stats_pending')
              : 'Estadísticas de faltas y bola parada en proceso'
          }
        />
      </View>
    );
  }

  const homeGoals = stats.homeGoals ?? 0;
  const awayGoals = stats.awayGoals ?? 0;

  const homeDF = stats.homeDirectFouls ?? { total: 0, scored: 0 };
  const awayDF = stats.awayDirectFouls ?? { total: 0, scored: 0 };

  const homePen = stats.homePenalties ?? { total: 0, scored: 0 };
  const awayPen = stats.awayPenalties ?? { total: 0, scored: 0 };

  return (
    <View className="px-3 pb-8">
      <View className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
        {/* Goles */}
        <StatRow
          label="Goles"
          home={homeGoals}
          away={awayGoals}
          homeNum={homeGoals}
          awayNum={awayGoals}
        />

        {/* Faltas de equipo */}
        <StatRow
          label="Faltas de equipo"
          home={stats.homeFouls}
          away={stats.awayFouls}
          homeNum={stats.homeFouls}
          awayNum={stats.awayFouls}
        />

        {/* Faltas directas */}
        {homeDF.total > 0 || awayDF.total > 0 ? (
          <StatRow
            label="Faltas directas (goles / lanzadas)"
            home={`${homeDF.scored}/${homeDF.total}`}
            away={`${awayDF.scored}/${awayDF.total}`}
            homeNum={homeDF.scored}
            awayNum={awayDF.scored}
          />
        ) : null}

        {/* Penaltis */}
        {homePen.total > 0 || awayPen.total > 0 ? (
          <StatRow
            label="Penaltis (goles / lanzados)"
            home={`${homePen.scored}/${homePen.total}`}
            away={`${awayPen.scored}/${awayPen.total}`}
            homeNum={homePen.scored}
            awayNum={awayPen.scored}
          />
        ) : null}

        {/* Tarjetas azules */}
        <StatRow
          label="Tarjetas azules"
          home={stats.homeBlueCards ?? 0}
          away={stats.awayBlueCards ?? 0}
          homeNum={stats.homeBlueCards ?? 0}
          awayNum={stats.awayBlueCards ?? 0}
        />

        {/* Tarjetas rojas */}
        {(stats.homeRedCards ?? 0) > 0 || (stats.awayRedCards ?? 0) > 0 ? (
          <StatRow
            label="Tarjetas rojas"
            home={stats.homeRedCards ?? 0}
            away={stats.awayRedCards ?? 0}
            homeNum={stats.homeRedCards ?? 0}
            awayNum={stats.awayRedCards ?? 0}
          />
        ) : null}

        {/* Tiempos muertos */}
        {(stats.homeTimeouts ?? 0) > 0 || (stats.awayTimeouts ?? 0) > 0 ? (
          <StatRow
            label="Tiempos muertos"
            home={stats.homeTimeouts ?? 0}
            away={stats.awayTimeouts ?? 0}
            homeNum={stats.homeTimeouts ?? 0}
            awayNum={stats.awayTimeouts ?? 0}
          />
        ) : null}
      </View>
    </View>
  );
}
