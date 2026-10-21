import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useLocale } from '@/src/i18n/LocaleContext';
import { EmptyState } from '@/src/components/shared/EmptyState';
import {
  compareTimelineEvents,
  fmtEventClock,
  injectAccumulatedFouls,
  injectPeriodDividers,
  playerFullName,
  type AccumulatedFoulEvent,
  type PeriodDividerEvent,
} from '@/src/lib/match-helpers';
import type { MatchDetail } from '@/src/lib/api/types';

interface TimelineTabProps {
  events: MatchDetail['events'];
  homeTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  isScheduled: boolean;
}

export function TimelineTab({
  events,
  homeTeamId,
  homeTeamName,
  awayTeamName,
  isScheduled,
}: TimelineTabProps) {
  const { t } = useLocale();

  const timeline = useMemo(() => {
    if (!events || events.length === 0) return [];
    // 1. Orden cronológico
    const sorted = [...events].sort(compareTimelineEvents);
    // 2. Faltas acumuladas
    const withFouls = injectAccumulatedFouls(sorted, homeTeamId);
    // 3. Divisores de periodo
    return injectPeriodDividers(withFouls);
  }, [events, homeTeamId]);

  if (timeline.length === 0) {
    return (
      <View className="items-center justify-center px-6 py-12">
        <EmptyState
          title={
            isScheduled
              ? t('match_detail.waiting_start')
              : t('match_detail.no_events')
          }
          hint={
            isScheduled
              ? t('match_detail.waiting_start_body')
              : undefined
          }
        />
      </View>
    );
  }

  return (
    <View className="px-3 pb-8">
      {timeline.map((ev, idx) => {
        if (ev.eventType === 'period_divider') {
          const p = (ev as PeriodDividerEvent).period;
          const pLabel =
            p === 1
              ? t('match_states.first_half')
              : p === 2
                ? t('match_states.second_half')
                : p > 2
                  ? `${t('match_states.overtime')} ${p - 2}`
                  : `Periodo ${p}`;

          return (
            <View key={ev.id || `p-${idx}`} className="my-4 flex-row items-center gap-3">
              <View className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              <View className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
                <Text className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  {pLabel}
                </Text>
              </View>
              <View className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            </View>
          );
        }

        if (ev.eventType === 'accumulated_foul') {
          const acc = ev as AccumulatedFoulEvent;
          return (
            <View key={ev.id || `acc-${idx}`} className="my-2 items-center">
              <View className="flex-row items-center gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-1.5 dark:border-amber-700/50 dark:bg-amber-950/40">
                <Text className="text-xs">⚠️</Text>
                <Text className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                  {acc.foulNumber}ª Falta de equipo ·{' '}
                  {acc.isHomeTeam ? homeTeamName : awayTeamName}
                </Text>
                <Text className="text-[10px] text-amber-600 dark:text-amber-400 tabular-nums">
                  {fmtEventClock(acc)}
                </Text>
              </View>
            </View>
          );
        }

        // Evento ordinario de partido
        const isHome = ev.isHomeTeam;
        const clock = fmtEventClock(ev);
        const player = 'player' in ev && ev.player ? playerFullName(ev.player) : null;

        let icon = '•';
        let eventTitle = ev.eventType;
        let badgeColor = 'bg-slate-100 dark:bg-slate-800';

        if (ev.eventType === 'goal') {
          icon = '🏑';
          eventTitle = '¡GOL!';
          badgeColor = 'bg-emerald-500/15 border-emerald-500/30';
        } else if (ev.eventType === 'blue_card') {
          icon = '🟦';
          eventTitle = 'Tarjeta azul';
          badgeColor = 'bg-blue-500/15 border-blue-500/30';
        } else if (ev.eventType === 'red_card') {
          icon = '🟥';
          eventTitle = 'Tarjeta roja';
          badgeColor = 'bg-rose-500/15 border-rose-500/30';
        } else if (ev.eventType === 'penalty') {
          icon = '🥅';
          eventTitle = 'Penalti';
        } else if (ev.eventType === 'direct_foul') {
          icon = '🎯';
          eventTitle = 'Falta directa';
        } else if (ev.eventType === 'timeout') {
          icon = '⏱️';
          eventTitle = 'Tiempo muerto';
        } else if (ev.eventType === 'foul') {
          icon = '•';
          eventTitle = 'Falta';
        }

        return (
          <View
            key={ev.id || `ev-${idx}`}
            className={`my-1.5 flex-row items-center ${isHome ? 'justify-start' : 'justify-end'}`}
          >
            {isHome ? (
              <View className="max-w-[85%] flex-row items-center gap-2">
                {/* Minuto / Reloj */}
                <View className="min-w-[42px] items-center rounded-md bg-slate-200/80 px-1.5 py-0.5 dark:bg-slate-800">
                  <Text className="text-[10px] font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                    {clock}
                  </Text>
                </View>

                {/* Tarjeta de evento */}
                <View
                  className={`rounded-2xl border px-3.5 py-2 shadow-sm ${badgeColor} bg-white dark:bg-slate-900 border-slate-200/70 dark:border-slate-800`}
                >
                  <View className="flex-row items-center gap-1.5">
                    <Text className="text-sm">{icon}</Text>
                    <Text className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {eventTitle}
                    </Text>
                  </View>
                  {player ? (
                    <Text className="mt-0.5 text-xs text-slate-700 dark:text-slate-300">
                      {player}
                    </Text>
                  ) : ev.detail ? (
                    <Text className="mt-0.5 text-xs text-slate-500">{ev.detail}</Text>
                  ) : null}
                </View>
              </View>
            ) : (
              <View className="max-w-[85%] flex-row items-center gap-2">
                {/* Tarjeta de evento */}
                <View
                  className={`rounded-2xl border px-3.5 py-2 shadow-sm ${badgeColor} bg-white dark:bg-slate-900 border-slate-200/70 dark:border-slate-800`}
                >
                  <View className="flex-row items-center justify-end gap-1.5">
                    <Text className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {eventTitle}
                    </Text>
                    <Text className="text-sm">{icon}</Text>
                  </View>
                  {player ? (
                    <Text className="mt-0.5 text-right text-xs text-slate-700 dark:text-slate-300">
                      {player}
                    </Text>
                  ) : ev.detail ? (
                    <Text className="mt-0.5 text-right text-xs text-slate-500">{ev.detail}</Text>
                  ) : null}
                </View>

                {/* Minuto / Reloj */}
                <View className="min-w-[42px] items-center rounded-md bg-slate-200/80 px-1.5 py-0.5 dark:bg-slate-800">
                  <Text className="text-[10px] font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                    {clock}
                  </Text>
                </View>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
