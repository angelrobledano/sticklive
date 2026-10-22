import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useLocale } from '@/src/i18n/LocaleContext';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { GoalStickIcon } from '@/src/components/shared/GoalStickIcon';
import {
  compareTimelineEvents,
  eventSurname,
  fmtEventClock,
  injectAccumulatedFouls,
  injectPeriodDividers,
  playerFullName,
  timelineWindow,
  type AccumulatedFoulEvent,
  type PeriodDividerEvent,
  type TimelineEvent,
} from '@/src/lib/match-helpers';
import type { MatchDetail } from '@/src/lib/api/types';

interface TimelineTabProps {
  events: MatchDetail['events'];
  homeTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  isScheduled: boolean;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return Object.entries(params).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
    template
  );
}

function TimelineEventIcon({ type }: { type: TimelineEvent['eventType'] }) {
  switch (type) {
    case 'goal':
      return <GoalStickIcon />;
    case 'blue_card':
      return (
        <View className="h-7 w-5 shrink-0 items-center justify-center rounded-[3px] bg-blue-500 shadow-sm">
          <Text className="text-[10px] font-black leading-none text-white">A</Text>
        </View>
      );
    case 'red_card':
      return (
        <View className="h-7 w-5 shrink-0 items-center justify-center rounded-[3px] bg-rose-600 shadow-sm">
          <Text className="text-[10px] font-black leading-none text-white">R</Text>
        </View>
      );
    case 'penalty':
      return (
        <View className="h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-500 shadow-sm">
          <Text className="text-[10px] font-black leading-none text-white">P</Text>
        </View>
      );
    case 'direct_foul':
      return (
        <View className="h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-500 shadow-sm">
          <Ionicons name="disc-outline" size={17} color="white" />
        </View>
      );
    case 'accumulated_foul':
      return (
        <View className="h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-500 shadow-sm">
          <Ionicons name="warning-outline" size={15} color="white" />
        </View>
      );
    case 'timeout':
      return (
        <View className="h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
          <Ionicons name="time-outline" size={10} color="#64748b" />
        </View>
      );
    case 'foul':
    default:
      return (
        <View className="h-4 w-4 shrink-0 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/40">
          <View className="h-1.5 w-1.5 rounded-full bg-orange-500" />
        </View>
      );
  }
}

function eventTitle(
  ev: TimelineEvent,
  t: (k: string) => string
): string {
  switch (ev.eventType) {
    case 'goal':
      return t('timeline_events.goal');
    case 'penalty':
      return t('timeline_events.penalty');
    case 'blue_card':
      return t('timeline_events.blue_card');
    case 'red_card':
      return t('timeline_events.red_card');
    case 'timeout':
      return t('timeline_events.timeout');
    case 'foul':
      return t('timeline_events.foul');
    case 'direct_foul':
      return t('timeline_events.direct_foul');
    case 'accumulated_foul': {
      const v = ev as AccumulatedFoulEvent;
      return interpolate(t('timeline_events.team_foul_nth'), { n: v.foulNumber });
    }
    default:
      return '';
  }
}

function TimelineRow({
  ev,
  homeName,
  awayName,
  sameInstantAsPrev,
}: {
  ev: TimelineEvent;
  homeName: string;
  awayName: string;
  sameInstantAsPrev: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();

  // 1. Divisor de periodo (1ª parte, 2ª parte, prórroga)
  if (ev.eventType === 'period_divider') {
    const p = (ev as PeriodDividerEvent).period;
    const periodLabel =
      p === 1
        ? t('match_detail.first_half')
        : p === 2
          ? t('match_detail.second_half')
          : interpolate(t('match_detail.overtime'), { n: p - 2 });

    return (
      <View className="my-1.5 flex-row items-center gap-3 py-2">
        <View className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        <View className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
          <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300">
            {periodLabel}
          </Text>
        </View>
        <View className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      </View>
    );
  }

  const isVirtual = ev.eventType === 'accumulated_foul';
  const isHome = ev.isHomeTeam;
  const directScored = ev.eventType === 'direct_foul' && !!ev.detail?.includes('marcada');
  const penaltyScored =
    ev.eventType === 'penalty' &&
    !!ev.detail &&
    (ev.detail.toLowerCase().includes('gol') || ev.detail.toLowerCase().includes('marc'));

  const outcomeText =
    ev.eventType === 'direct_foul' && ev.detail
      ? directScored
        ? t('timeline_events.scored')
        : t('timeline_events.missed')
      : ev.eventType === 'penalty' && ev.detail
        ? penaltyScored
          ? t('timeline_events.scored')
          : t('timeline_events.missed')
        : null;

  const outcomeIsScored = ev.eventType === 'direct_foul' ? directScored : penaltyScored;

  // Jerarquía visual en 3 niveles (réplica del modelo web)
  const tier: 'high' | 'mid' | 'low' =
    ev.eventType === 'goal' || ev.eventType === 'blue_card' || ev.eventType === 'red_card'
      ? 'high'
      : ev.eventType === 'timeout' || ev.eventType === 'foul'
        ? 'low'
        : 'mid';

  const isGoal = ev.eventType === 'goal';
  const titleColor = isGoal
    ? 'text-emerald-600 dark:text-emerald-400'
    : ev.eventType === 'blue_card'
      ? 'text-blue-600 dark:text-blue-400'
      : ev.eventType === 'red_card'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-slate-800 dark:text-slate-200';

  const playerObj = 'player' in ev && ev.player ? ev.player : null;
  const fullName = playerFullName(playerObj);
  const surname = playerObj ? eventSurname(playerObj) : null;
  const playerId = playerObj?.id;

  // Celda de contenido según el nivel visual
  let cellContent: React.ReactNode;

  if (isVirtual) {
    // Aviso de 10ª / 15ª falta de equipo (siempre en el lado infractor)
    cellContent = (
      <View className="rounded-md border border-orange-200/60 bg-orange-50 px-2 py-0.5 dark:border-orange-800/40 dark:bg-orange-950/40">
        <Text className="text-[11px] font-medium text-orange-800 dark:text-orange-300">
          {eventTitle(ev, t)}
        </Text>
      </View>
    );
  } else if (tier === 'low') {
    // Tiempo muerto / Falta individual (una sola línea mínima gris)
    cellContent = (
      <Text className="text-[11px] text-slate-500 dark:text-slate-300" numberOfLines={1}>
        {eventTitle(ev, t)}
        {ev.eventType === 'foul' && surname ? ` · ${surname}` : ''}
      </Text>
    );
  } else if (tier === 'high') {
    // Nivel Alto: Goles y tarjetas con el nombre del jugador protagonista en negrita
    cellContent = (
      <View className={`min-w-0 ${isHome ? 'items-end' : 'items-start'}`}>
        {fullName ? (
          <Pressable
            onPress={() => {
              if (playerId) {
                router.push({ pathname: '/player/[id]', params: { id: playerId } });
              }
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text
              numberOfLines={1}
              className="text-[13px] font-bold text-slate-900 active:underline dark:text-slate-100"
            >
              {fullName}
            </Text>
          </Pressable>
        ) : null}
        <View className="flex-row items-center gap-1">
          <Text className={`text-xs font-semibold ${titleColor}`}>
            {eventTitle(ev, t)}
          </Text>
          {isGoal && ev.detail ? (
            <Text className="font-mono text-xs font-bold text-slate-500 dark:text-slate-400">
              {ev.detail}
            </Text>
          ) : null}
        </View>
      </View>
    );
  } else {
    // Nivel Medio: Penaltis y Faltas directas con desenlace destacado (MARCADA / FALLADA)
    cellContent = (
      <View className={`min-w-0 max-w-full ${isHome ? 'items-end' : 'items-start'}`}>
        <View className={`flex-row flex-wrap items-center gap-x-1 ${isHome ? 'justify-end' : 'justify-start'}`}>
          <Text
            numberOfLines={1}
            className="text-xs font-semibold text-slate-800 dark:text-slate-200"
          >
            {eventTitle(ev, t)}
          </Text>
          {outcomeText ? (
            <Text
              numberOfLines={1}
              className={`text-xs font-bold uppercase tracking-wide ${
                outcomeIsScored
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              · {outcomeText}
            </Text>
          ) : null}
        </View>
        {fullName ? (
          <Pressable
            onPress={() => {
              if (playerId) {
                router.push({ pathname: '/player/[id]', params: { id: playerId } });
              }
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text
              numberOfLines={1}
              className="text-xs text-slate-500 active:underline dark:text-slate-300"
            >
              {fullName}
            </Text>
          </Pressable>
        ) : (
          <Text
            numberOfLines={1}
            className="text-xs text-slate-500 dark:text-slate-300"
          >
            {isHome ? homeName : awayName}
          </Text>
        )}
      </View>
    );
  }

  const rowPadding =
    tier === 'low' ? 'py-0.5' : tier === 'high' ? 'py-1.5' : 'py-1';
  const linkedMargin = sameInstantAsPrev ? '-mt-1' : '';
  const clock = fmtEventClock(ev);

  return (
    <View
      className={`flex-row items-center ${rowPadding} ${linkedMargin}`}
    >
      {/* Columna Local (Izquierda) */}
      <View className="flex-1 items-end justify-center pr-1.5 min-h-[26px]">
        {isHome ? (
          <View className="flex-row items-center justify-end gap-2 max-w-full">
            <View className="flex-1 items-end min-w-0">{cellContent}</View>
            <TimelineEventIcon type={ev.eventType} />
          </View>
        ) : null}
      </View>

      {/* Nodo del Crono Central (50px exactos sobre el eje) */}
      <View className="w-[50px] items-center justify-center z-10 shrink-0">
        <View className="rounded bg-white px-1 py-0.5 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60">
          <Text
            className={`font-mono text-center tabular-nums ${
              sameInstantAsPrev
                ? 'text-[11px] text-slate-300 dark:text-slate-400'
                : tier === 'low'
                  ? 'text-[10px] text-slate-400 dark:text-slate-400 font-medium'
                  : 'text-[11px] font-bold text-slate-600 dark:text-slate-200'
            }`}
          >
            {sameInstantAsPrev ? '-' : clock}
          </Text>
        </View>
      </View>

      {/* Columna Visitante (Derecha) */}
      <View className="flex-1 items-start justify-center pl-1.5 min-h-[26px]">
        {!isHome ? (
          <View className="flex-row items-center justify-start gap-2 max-w-full">
            <TimelineEventIcon type={ev.eventType} />
            <View className="flex-1 items-start min-w-0">{cellContent}</View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function TimelineTab({
  events,
  homeTeamId,
  homeTeamName,
  awayTeamName,
  isScheduled,
}: TimelineTabProps) {
  const { t } = useLocale();
  const [showAll, setShowAll] = useState(false);

  const timeline = useMemo(() => {
    if (!events || events.length === 0) return [];
    // 1. Orden cronológico réplica del backend
    const sorted = [...events].sort(compareTimelineEvents);
    // 2. Inyección de faltas acumuladas (10ª, 15ª, etc.)
    const withFouls = injectAccumulatedFouls(sorted, homeTeamId);
    // 3. Divisores de periodo (1ª parte, 2ª parte, prórroga)
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

  const { visible, hiddenCount } = timelineWindow(timeline, showAll);

  return (
    <View className="px-3 pb-8">
      {/* Tarjeta contenedora con eje central simétrico */}
      <View className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white px-2 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {/* Eje central vertical que conecta cronológicamente los eventos */}
        <View
          style={{ left: '50%', transform: [{ translateX: -0.5 }] }}
          className="absolute top-3 bottom-3 w-px bg-slate-100 dark:bg-slate-800"
          pointerEvents="none"
        />

        {visible.map((ev, i) => {
          const prev = visible[i - 1];
          const prevClock = (prev as { clock?: string | null })?.clock;
          const evClock = (ev as { clock?: string | null })?.clock;

          const sameInstant =
            !!prev &&
            !!evClock &&
            prevClock === evClock &&
            prev.period === ev.period &&
            prev.eventType !== 'period_divider';

          return (
            <TimelineRow
              key={ev.id || `ev-${i}`}
              ev={ev}
              homeName={homeTeamName}
              awayName={awayTeamName}
              sameInstantAsPrev={sameInstant}
            />
          );
        })}

        {hiddenCount > 0 && (
          <Pressable
            onPress={() => setShowAll(true)}
            className="mt-3 w-full items-center justify-center rounded-xl border border-slate-200 py-2.5 active:bg-slate-50 dark:border-slate-800 dark:active:bg-slate-800/60"
          >
            <Text className="text-xs font-semibold text-rose-600 dark:text-rose-400">
              {interpolate(t('match_detail.show_all_events'), { n: hiddenCount })}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
