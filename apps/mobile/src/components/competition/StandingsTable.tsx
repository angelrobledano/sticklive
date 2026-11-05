import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { SeasonStandingRow } from '@sports/core/api';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { useLocale } from '@/src/i18n/LocaleContext';
import { clubName } from '@sports/core/names';
import {
  rowZones,
  zoneChangesAfter,
  zoneLegend,
  type RowZone,
  type ZoneKind,
} from '@/src/lib/standings-zones-view';

interface Props {
  rows: SeasonStandingRow[];
  legacyZones?: boolean;
}

const ZONE_STYLE: Record<ZoneKind, { border: string; dot: string }> = {
  champion: {
    border: 'border-l-amber-500',
    dot: 'bg-amber-500',
  },
  promotion: {
    border: 'border-l-emerald-500',
    dot: 'bg-emerald-500',
  },
  promotion_playoff: {
    border: 'border-l-rink-passion dark:border-l-rose-400',
    dot: 'bg-rink-passion dark:bg-rose-400',
  },
  final_phase: {
    border: 'border-l-rink-passion dark:border-l-rose-400',
    dot: 'bg-rink-passion dark:bg-rose-400',
  },
  placement: {
    border: 'border-l-slate-400',
    dot: 'bg-slate-400',
  },
  playout: {
    border: 'border-l-orange-300',
    dot: 'bg-orange-300',
  },
  relegation: {
    border: 'border-l-orange-500 dark:border-l-orange-400',
    dot: 'bg-orange-500 dark:bg-orange-400',
  },
};

function zoneLabel(t: (k: string) => string, zone: RowZone): string {
  const base = t(`standings.zones.${zone.kind}`) || zone.kind;
  return zone.target ? `${base} (${zone.target})` : base;
}

export function StandingsTable({ rows, legacyZones = true }: Props) {
  const router = useRouter();
  const { t } = useLocale();
  const [showColHelp, setShowColHelp] = useState(false);

  const zones = useMemo(() => rowZones(rows, { legacyFallback: legacyZones }), [rows, legacyZones]);
  const cuts = useMemo(() => zoneChangesAfter(zones), [zones]);
  const legend = useMemo(() => zoneLegend(zones), [zones]);

  return (
    <View className="mb-3 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
      {/* Cabecera tabla */}
      <View className="flex-row items-center border-b border-slate-100 px-2.5 py-2 dark:border-slate-800">
        <Text className="w-6 text-center text-xs font-bold text-slate-400">#</Text>
        <Text className="flex-1 text-xs font-bold uppercase text-slate-500 dark:text-slate-400 pl-1">
          {t('standings.team') || 'Equipo'}
        </Text>
        <Text className="w-6 text-center text-[11px] font-bold text-slate-400">
          {t('standings.cols.played') || 'PJ'}
        </Text>
        <Text className="w-6 text-center text-[11px] font-bold text-slate-400">
          {t('standings.cols.won') || 'PG'}
        </Text>
        <Text className="w-6 text-center text-[11px] font-bold text-slate-400">
          {t('standings.cols.drawn') || 'PE'}
        </Text>
        <Text className="w-6 text-center text-[11px] font-bold text-slate-400">
          {t('standings.cols.lost') || 'PP'}
        </Text>
        <Text className="w-7 text-center text-[11px] font-bold text-slate-400">
          {t('standings.cols.gd') || t('standings.cols.diff') || 'DG'}
        </Text>
        <Text className="w-7 text-center text-xs font-bold text-slate-900 dark:text-slate-100">
          {t('standings.cols.pts') || 'PT'}
        </Text>
      </View>

      {/* Filas */}
      {rows.map((row, idx) => {
        const zone = zones[idx];
        const isCut = cuts[idx];
        const style = zone ? ZONE_STYLE[zone.kind] : null;

        return (
          <Pressable
            key={row.id}
            onPress={() => router.push(`/team/${row.teamId}`)}
            accessibilityRole="button"
            className={`flex-row items-center px-2.5 py-2 border-l-2 active:opacity-70 ${
              style ? style.border : 'border-l-transparent'
            } ${
              isCut
                ? 'border-b-2 border-b-slate-200 dark:border-b-slate-700'
                : 'border-b border-slate-100 dark:border-slate-800'
            }`}
          >
            {/* Posición */}
            <Text className="w-6 text-center text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
              {row.position ?? '–'}
            </Text>

            {/* Escudo y Nombre */}
            <View className="flex-1 min-w-0 flex-row items-center pr-1 pl-1">
              <Avatar
                uri={teamLogoUri(row.teamId, 48)}
                fallbackUri={row.teamLogoUrl}
                name={row.teamName}
                size={20}
              />
              <Text
                numberOfLines={1}
                className="ml-1.5 flex-1 text-xs font-semibold text-slate-900 dark:text-slate-100"
              >
                {clubName(row.teamName) || row.teamShortName || row.teamName}
              </Text>
            </View>

            {/* PJ, PG, PE, PP */}
            <Text className="w-6 text-center text-xs tabular-nums text-slate-600 dark:text-slate-300">
              {row.played}
            </Text>
            <Text className="w-6 text-center text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {row.won}
            </Text>
            <Text className="w-6 text-center text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {row.drawn}
            </Text>
            <Text className="w-6 text-center text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {row.lost}
            </Text>

            {/* DG */}
            <Text
              className={`w-7 text-center text-xs tabular-nums font-semibold ${
                row.goalDiff > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : row.goalDiff < 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-slate-400'
              }`}
            >
              {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
            </Text>

            {/* Puntos y penalización */}
            <View className="w-7 flex-row items-baseline justify-center gap-0.5">
              <Text className="text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {row.points}
              </Text>
              {row.penalizationPoints != null && row.penalizationPoints < 0 ? (
                <Text className="text-[8px] font-bold text-red-500 leading-none">
                  {row.penalizationPoints}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}

      {/* Leyenda de zonas */}
      {legend.length > 0 ? (
        <View className="flex-row flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 bg-slate-50/50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/30">
          {legend.map((z) => (
            <View key={`${z.kind}-${z.target ?? ''}`} className="flex-row items-center gap-1.5">
              <View className={`h-2 w-2 rounded-full ${ZONE_STYLE[z.kind].dot}`} />
              <Text className="text-[10px] text-slate-500 dark:text-slate-400">
                {z.kind === 'promotion_playoff' && !z.target && !rows.some((r) => r.zone)
                  ? t('standings.playoffs_zone') || 'Playoffs (1º–8º)'
                  : z.kind === 'relegation' && !z.target && !rows.some((r) => r.zone)
                  ? t('standings.relegation_zone') || 'Descenso (últimos 2)'
                  : zoneLabel(t, z)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Explicación de columnas (PJ, PG, PE, PP, DG, PT) */}
      <View className="border-t border-slate-100 dark:border-slate-800">
        <Pressable
          onPress={() => setShowColHelp((prev) => !prev)}
          accessibilityRole="button"
          accessibilityLabel={t('standings.legend_title') || 'Qué significan las columnas'}
          className="flex-row items-center justify-between px-3 py-2 bg-slate-50/30 dark:bg-slate-800/20 active:opacity-75"
        >
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="help-circle-outline" size={13} color="#94a3b8" />
            <Text className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
              {t('standings.legend_title') || 'Qué significan las columnas'}
            </Text>
          </View>
          <Ionicons
            name={showColHelp ? 'chevron-up' : 'chevron-down'}
            size={13}
            color="#94a3b8"
          />
        </Pressable>

        {showColHelp ? (
          <View className="px-3 pb-2.5 pt-1 bg-slate-50/50 dark:bg-slate-800/40">
            <View className="flex-row flex-wrap gap-x-4 gap-y-1">
              {[
                { key: 'played', fallbackShort: 'PJ', fallbackLong: 'Partidos jugados' },
                { key: 'won', fallbackShort: 'PG', fallbackLong: 'Ganados' },
                { key: 'drawn', fallbackShort: 'PE', fallbackLong: 'Empatados' },
                { key: 'lost', fallbackShort: 'PP', fallbackLong: 'Perdidos' },
                { key: 'gd', fallbackShort: 'DG', fallbackLong: 'Diferencia de goles' },
                { key: 'pts', fallbackShort: 'PT', fallbackLong: 'Puntos' },
              ].map(({ key, fallbackShort, fallbackLong }) => (
                <View key={key} className="flex-row items-baseline gap-1">
                  <Text className="text-[10px] font-bold text-slate-700 dark:text-slate-300">
                    {t(`standings.cols.${key}`) || fallbackShort}:
                  </Text>
                  <Text className="text-[10px] text-slate-500 dark:text-slate-400">
                    {t(`standings.cols_full.${key}`) || fallbackLong}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}
