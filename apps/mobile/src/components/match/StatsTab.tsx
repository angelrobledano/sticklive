import { useEffect, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { BRAND } from '@sports/brand';
import { useLocale } from '@/src/i18n/LocaleContext';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { calcEfficiency } from '@/src/lib/match-helpers';
import { clubName } from '@sports/core/names';
import type { MatchDetailRaw } from '@sports/core/api';

interface StatsTabProps {
  data: MatchDetailRaw;
}

interface StatRowProps {
  label: string;
  home: number;
  away: number;
  max?: number;
}

function StatRow({ label, home, away, max }: StatRowProps) {
  const safeMax = (max != null ? max : Math.max(home, away)) || 1;
  const homePct = Math.round((home / safeMax) * 100);
  const awayPct = Math.round((away / safeMax) * 100);

  // Animación fluida de las barras llenándose desde el centro hacia los extremos
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [anim, homePct, awayPct]);

  const homeWidth = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${homePct}%`],
  });

  const awayWidth = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${awayPct}%`],
  });

  return (
    <View className="my-2">
      <Text className="text-center text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
        {label}
      </Text>
      <View className="flex-row items-center gap-2">
        {/* Valor Local */}
        <Text className="w-8 text-right font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
          {home}
        </Text>

        {/* Dos barras enfrentadas desde el centro con animación de expansión */}
        <View className="flex-1 flex-row h-2 items-center gap-1">
          {/* Barra Local: llena de derecha a izquierda hacia el centro */}
          <View className="flex-1 flex-row justify-end h-full rounded-l-full bg-slate-100 overflow-hidden dark:bg-slate-800">
            <Animated.View
              className="h-full rounded-l-full"
              style={{
                width: homeWidth,
                backgroundColor: BRAND.granate,
              }}
            />
          </View>

          {/* Barra Visitante: llena de izquierda a derecha desde el centro */}
          <View className="flex-1 h-full rounded-r-full bg-slate-100 overflow-hidden dark:bg-slate-800">
            <Animated.View
              className="h-full rounded-r-full bg-slate-500 dark:bg-slate-400"
              style={{
                width: awayWidth,
              }}
            />
          </View>
        </View>

        {/* Valor Visitante */}
        <Text className="w-8 text-left font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
          {away}
        </Text>
      </View>
    </View>
  );
}

export function StatsTab({ data }: StatsTabProps) {
  const { t } = useLocale();
  const { stats, match } = data;

  const totalPen = (stats?.homePenalties?.total ?? 0) + (stats?.awayPenalties?.total ?? 0);
  const totalDF = (stats?.homeDirectFouls?.total ?? 0) + (stats?.awayDirectFouls?.total ?? 0);

  const hasAnyStats =
    stats &&
    (stats.homeFouls > 0 ||
      stats.awayFouls > 0 ||
      (stats.homeGoals ?? 0) > 0 ||
      (stats.awayGoals ?? 0) > 0 ||
      (stats.homeAssists ?? 0) > 0 ||
      (stats.awayAssists ?? 0) > 0 ||
      (stats.homeBlueCards ?? 0) > 0 ||
      (stats.awayBlueCards ?? 0) > 0 ||
      (stats.homeRedCards ?? 0) > 0 ||
      (stats.awayRedCards ?? 0) > 0 ||
      (stats.homeTimeouts ?? 0) > 0 ||
      (stats.awayTimeouts ?? 0) > 0 ||
      totalDF > 0 ||
      totalPen > 0);

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

  const homeLabel = clubName(match.homeTeam.name) || match.homeTeam.shortName || match.homeTeam.name;
  const awayLabel = clubName(match.awayTeam.name) || match.awayTeam.shortName || match.awayTeam.name;

  const homeGoals = stats.homeGoals ?? 0;
  const awayGoals = stats.awayGoals ?? 0;
  const homeAssists = stats.homeAssists ?? 0;
  const awayAssists = stats.awayAssists ?? 0;

  const homeDF = stats.homeDirectFouls ?? { total: 0, scored: 0 };
  const awayDF = stats.awayDirectFouls ?? { total: 0, scored: 0 };
  const homeDFEff = calcEfficiency(homeDF.scored, homeDF.total);
  const awayDFEff = calcEfficiency(awayDF.scored, awayDF.total);

  const homePen = stats.homePenalties ?? { total: 0, scored: 0 };
  const awayPen = stats.awayPenalties ?? { total: 0, scored: 0 };
  const homePenEff = calcEfficiency(homePen.scored, homePen.total);
  const awayPenEff = calcEfficiency(awayPen.scored, awayPen.total);

  return (
    <View className="px-3 pb-8">
      <View className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
        {/* Cabecera de columnas con nombres de equipo */}
        <View className="flex-row items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <Text
            className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 max-w-[45%]"
            numberOfLines={1}
          >
            {homeLabel}
          </Text>
          <Text
            className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 max-w-[45%] text-right"
            numberOfLines={1}
          >
            {awayLabel}
          </Text>
        </View>

        {/* Goles */}
        <StatRow
          label={t('hockey_stats.goals')}
          home={homeGoals}
          away={awayGoals}
        />

        {/* Asistencias (si alguno > 0) */}
        {homeAssists > 0 || awayAssists > 0 ? (
          <StatRow
            label={t('hockey_stats.assists')}
            home={homeAssists}
            away={awayAssists}
          />
        ) : null}

        <View className="h-px bg-slate-100 dark:bg-slate-800 my-2" />

        {/* Faltas de equipo */}
        <StatRow
          label={t('match_detail.team_fouls_header')}
          home={stats.homeFouls}
          away={stats.awayFouls}
        />

        {/* Tarjetas azules */}
        <StatRow
          label={t('hockey_stats.blue_cards')}
          home={stats.homeBlueCards ?? 0}
          away={stats.awayBlueCards ?? 0}
        />

        {/* Tarjetas rojas (si alguno > 0) */}
        {(stats.homeRedCards ?? 0) > 0 || (stats.awayRedCards ?? 0) > 0 ? (
          <StatRow
            label={t('hockey_stats.red_cards')}
            home={stats.homeRedCards ?? 0}
            away={stats.awayRedCards ?? 0}
          />
        ) : null}

        {/* Tiempos muertos (si alguno > 0) */}
        {(stats.homeTimeouts ?? 0) > 0 || (stats.awayTimeouts ?? 0) > 0 ? (
          <StatRow
            label={t('hockey_stats.time_outs')}
            home={stats.homeTimeouts ?? 0}
            away={stats.awayTimeouts ?? 0}
          />
        ) : null}

        {/* Faltas directas (si hay lanzamientos) */}
        {totalDF > 0 ? (
          <>
            <View className="h-px bg-slate-100 dark:bg-slate-800 my-2" />
            <StatRow
              label={t('hockey_stats.direct_fouls_shot')}
              home={homeDF.total}
              away={awayDF.total}
            />
            <StatRow
              label={t('hockey_stats.direct_fouls_scored')}
              home={homeDF.scored}
              away={awayDF.scored}
              max={Math.max(homeDF.total, awayDF.total, 1)}
            />
            {/* Fila de efectividad */}
            <View className="flex-row items-baseline justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
              <Text className="w-10 text-right font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                {homeDFEff}%
              </Text>
              <Text className="flex-1 text-center text-[10px] text-slate-500 dark:text-slate-400 px-2">
                {t('match_detail.direct_fouls_efficiency')}
              </Text>
              <Text className="w-10 text-left font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                {awayDFEff}%
              </Text>
            </View>
          </>
        ) : null}

        {/* Penaltis (si hay lanzamientos en tiempo reglamentario / prórroga) */}
        {totalPen > 0 ? (
          <>
            <View className="h-px bg-slate-100 dark:bg-slate-800 my-2" />
            <StatRow
              label={t('hockey_stats.penalties_shot')}
              home={homePen.total}
              away={awayPen.total}
            />
            <StatRow
              label={t('hockey_stats.penalties_scored')}
              home={homePen.scored}
              away={awayPen.scored}
              max={Math.max(homePen.total, awayPen.total, 1)}
            />
            {/* Fila de efectividad */}
            <View className="flex-row items-baseline justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
              <Text className="w-10 text-right font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                {homePenEff}%
              </Text>
              <Text className="flex-1 text-center text-[10px] text-slate-500 dark:text-slate-400 px-2">
                {t('match_detail.penalties_efficiency')}
              </Text>
              <Text className="w-10 text-left font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                {awayPenEff}%
              </Text>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}
