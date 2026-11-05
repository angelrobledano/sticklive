import { useMemo, useState } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useLocale } from '@/src/i18n/LocaleContext';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { AdBanner } from '@/src/components/ads/AdBanner';
import { clubName } from '@/src/lib/names';
import { formatKickoff, isEffectivelyLive } from '@/src/lib/time';
import {
  isHorizontalSwipeGesture,
  madridTodayKey,
  resolveDaySwipeDelta,
} from '@/src/lib/day-view';
import {
  dateNeighbor,
  dayPillLabel,
  defaultRoundSelection,
  madridDay,
  matchesOfSelection,
  nearestMatchDay,
  roundLabel,
  roundSelection,
  roundSelectionKey,
  selectableRounds,
  type FixturesFilterMode,
  type RoundItem,
  type RoundSelection,
} from '@/src/lib/round-selection';
import type { SeasonMatch } from '@/src/lib/api/types';

interface TeamItem {
  id: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
}

interface GameweeksTabProps {
  rounds: RoundItem[];
  matches: SeasonMatch[];
}

export function GameweeksTab({ rounds, matches }: GameweeksTabProps) {
  const { t, locale } = useLocale();
  const router = useRouter();

  const orderedRounds = useMemo(() => selectableRounds(rounds, matches), [rounds, matches]);

  const teams = useMemo<TeamItem[]>(() => {
    const map = new Map<string, TeamItem>();
    for (const m of matches) {
      if (m.homeTeam?.id && !map.has(m.homeTeam.id)) {
        map.set(m.homeTeam.id, m.homeTeam);
      }
      if (m.awayTeam?.id && !map.has(m.awayTeam.id)) {
        map.set(m.awayTeam.id, m.awayTeam);
      }
    }
    return [...map.values()].sort((a, b) =>
      (a.shortName ?? a.name).localeCompare(b.shortName ?? b.name),
    );
  }, [matches]);

  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const m of matches) {
      const d = madridDay(m.scheduledAt, m.competitionTimezone);
      if (d) set.add(d);
    }
    return [...set].sort();
  }, [matches]);

  const todayKey = madridTodayKey();

  const availableModes = useMemo<FixturesFilterMode[]>(() => {
    const modes: FixturesFilterMode[] = [];
    if (orderedRounds.length > 0) modes.push('round');
    if (dates.length > 0) modes.push('date');
    if (teams.length > 0) modes.push('team');
    return modes.length > 0 ? modes : ['round'];
  }, [orderedRounds.length, dates.length, teams.length]);

  const [mode, setMode] = useState<FixturesFilterMode>('round');

  const defaultRound = useMemo(
    () => defaultRoundSelection(orderedRounds, matches, todayKey),
    [orderedRounds, matches, todayKey],
  );

  const nearest = useMemo(() => nearestMatchDay(matches, todayKey), [matches, todayKey]);

  const [selectedRound, setSelectedRound] = useState<RoundSelection | null>(defaultRound);
  const [selectedDate, setSelectedDate] = useState<string | null>(
    nearest?.day ?? dates[0] ?? null,
  );
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [showRoundModal, setShowRoundModal] = useState(false);

  const activeRoundKey = selectedRound ? roundSelectionKey(selectedRound) : null;
  const defaultRoundKey = defaultRound ? roundSelectionKey(defaultRound) : null;
  const isViewingDefaultRound = Boolean(activeRoundKey && activeRoundKey === defaultRoundKey);

  const roundIdx = useMemo(() => {
    if (!activeRoundKey) return -1;
    return orderedRounds.findIndex((r) => roundSelectionKey(roundSelection(r)) === activeRoundKey);
  }, [activeRoundKey, orderedRounds]);

  const prevRound = roundIdx > 0 ? orderedRounds[roundIdx - 1] : undefined;
  const nextRound =
    roundIdx >= 0 && roundIdx < orderedRounds.length - 1 ? orderedRounds[roundIdx + 1] : undefined;

  const prevDate = useMemo(() => dateNeighbor(dates, selectedDate, -1), [dates, selectedDate]);
  const nextDate = useMemo(() => dateNeighbor(dates, selectedDate, 1), [dates, selectedDate]);

  const activeTeam = useMemo(
    () => teams.find((tm) => tm.id === selectedTeamId) ?? null,
    [teams, selectedTeamId],
  );

  const filteredMatches = useMemo(() => {
    if (mode === 'team') {
      if (!activeTeam) return [];
      return matches
        .filter((m) => m.homeTeam?.id === activeTeam.id || m.awayTeam?.id === activeTeam.id)
        .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''));
    }
    if (mode === 'date' && selectedDate) {
      return matches
        .filter((m) => madridDay(m.scheduledAt, m.competitionTimezone) === selectedDate)
        .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''));
    }
    if (mode === 'round' && selectedRound) {
      return matchesOfSelection(matches, selectedRound).sort((a, b) =>
        (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''),
      );
    }
    return [];
  }, [matches, mode, activeTeam, selectedDate, selectedRound]);

  // Gestos táctiles de deslizamiento horizontal (swipe left/right) para avanzar/retroceder
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          isHorizontalSwipeGesture(gestureState.dx, gestureState.dy),
        onMoveShouldSetPanResponderCapture: (_, gestureState) =>
          isHorizontalSwipeGesture(gestureState.dx, gestureState.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_, gestureState) => {
          const delta = resolveDaySwipeDelta(gestureState.dx, gestureState.vx);
          if (delta === 1) {
            // Desplazamiento a la izquierda -> siguiente
            if (mode === 'round' && nextRound) {
              setSelectedRound(roundSelection(nextRound));
            } else if (mode === 'date' && nextDate) {
              setSelectedDate(nextDate);
            }
          } else if (delta === -1) {
            // Desplazamiento a la derecha -> anterior
            if (mode === 'round' && prevRound) {
              setSelectedRound(roundSelection(prevRound));
            } else if (mode === 'date' && prevDate) {
              setSelectedDate(prevDate);
            }
          }
        },
      }),
    [mode, nextRound, prevRound, nextDate, prevDate],
  );

  const activeRoundItem = useMemo(() => {
    if (roundIdx >= 0) return orderedRounds[roundIdx];
    return orderedRounds[0];
  }, [roundIdx, orderedRounds]);

  const activeRoundTitle = activeRoundItem
    ? roundLabel(activeRoundItem, t)
    : t('fixtures.filter_round') || 'Jornada';

  return (
    <View className="pt-2">
      {/* ── Toolbar con selector de modo (Jornada / Fecha / Equipo) ── */}
      <View className="mx-3 mb-2.5 flex-row gap-1 rounded-2xl bg-slate-200/70 p-1 dark:bg-slate-800">
        {availableModes.map((m) => {
          const active = m === mode;
          let iconName: keyof typeof Ionicons.glyphMap = 'list';
          let label = t('fixtures.filter_round') || 'Jornada';
          if (m === 'date') {
            iconName = 'calendar-outline';
            label = t('fixtures.filter_date') || 'Fecha';
          } else if (m === 'team') {
            iconName = 'shield-outline';
            label = t('fixtures.filter_team') || 'Equipo';
          }

          return (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              className={`min-h-[44px] flex-1 flex-row items-center justify-center gap-1.5 rounded-xl px-2 ${
                active
                  ? 'bg-white shadow-xs dark:bg-slate-900'
                  : 'active:bg-slate-300/40 dark:active:bg-slate-700/50'
              }`}
            >
              <Ionicons
                name={iconName}
                size={14}
                color={active ? '#dc2626' : '#64748b'}
              />
              <Text
                className={`text-xs ${
                  active
                    ? 'font-bold text-rink-passion dark:text-rink-accent'
                    : 'font-medium text-slate-600 dark:text-slate-400'
                }`}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── Control del modo activo ── */}

      {/* Modo: JORNADA (RoundPicker) */}
      {mode === 'round' && orderedRounds.length > 0 && (
        <View className="mx-3 mb-3 flex-row items-center gap-2">
          <Pressable
            onPress={prevRound ? () => setSelectedRound(roundSelection(prevRound)) : undefined}
            disabled={!prevRound}
            accessibilityLabel={t('fixtures.prev_round') || 'Jornada anterior'}
            className={`h-11 w-11 items-center justify-center rounded-xl border ${
              !prevRound
                ? 'border-slate-200 opacity-30 dark:border-slate-800'
                : 'border-slate-200 bg-white active:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:active:bg-slate-800'
            }`}
          >
            <Ionicons
              name="chevron-back"
              size={18}
              color={!prevRound ? '#94a3b8' : '#64748b'}
            />
          </Pressable>

          <Pressable
            onPress={() => setShowRoundModal(true)}
            accessibilityLabel={t('fixtures.by_round') || 'Filtrar por jornada'}
            className="min-h-[44px] flex-1 flex-row items-center justify-between rounded-xl border border-slate-200 bg-white px-3.5 active:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:active:bg-slate-800/80"
          >
            <View className="flex-row items-center gap-2 flex-1 min-w-0 pr-1">
              <Text
                numberOfLines={1}
                className="text-sm font-semibold text-slate-800 dark:text-slate-100"
              >
                {activeRoundTitle}
              </Text>
              {isViewingDefaultRound ? (
                <View className="rounded-full bg-rose-100 px-2 py-0.5 dark:bg-rose-950/60">
                  <Text className="text-[10px] font-bold text-rose-800 dark:text-rose-300">
                    {t('fixtures.current_round') || 'Actual'}
                  </Text>
                </View>
              ) : null}
            </View>
            <Ionicons name="chevron-down" size={16} color="#64748b" />
          </Pressable>

          <Pressable
            onPress={nextRound ? () => setSelectedRound(roundSelection(nextRound)) : undefined}
            disabled={!nextRound}
            accessibilityLabel={t('fixtures.next_round') || 'Jornada siguiente'}
            className={`h-11 w-11 items-center justify-center rounded-xl border ${
              !nextRound
                ? 'border-slate-200 opacity-30 dark:border-slate-800'
                : 'border-slate-200 bg-white active:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:active:bg-slate-800'
            }`}
          >
            <Ionicons
              name="chevron-forward"
              size={18}
              color={!nextRound ? '#94a3b8' : '#64748b'}
            />
          </Pressable>
        </View>
      )}

      {/* Botón rápido para volver a la jornada actual cuando se explora otra */}
      {mode === 'round' && !isViewingDefaultRound && defaultRound && (
        <View className="mx-3 -mt-1.5 mb-2.5 flex-row justify-end">
          <Pressable
            onPress={() => setSelectedRound(defaultRound)}
            className="flex-row items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 border border-rose-200/80 dark:bg-rose-950/40 dark:border-rose-900/60 active:opacity-75"
            accessibilityRole="button"
            accessibilityLabel={t('fixtures.jump_to_current') || 'Ir a jornada actual'}
          >
            <Ionicons name="arrow-undo-outline" size={12} color="#be123c" />
            <Text className="text-xs font-semibold text-rose-800 dark:text-rose-300">
              {t('fixtures.jump_to_current') || 'Ir a jornada actual'}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Modo: FECHA (DatePills con navegación previa/siguiente) */}
      {mode === 'date' && dates.length > 0 && (
        <View className="mx-3 mb-3 flex-row items-center gap-2">
          <Pressable
            onPress={prevDate ? () => setSelectedDate(prevDate) : undefined}
            disabled={!prevDate}
            accessibilityLabel={t('fixtures.prev_date') || 'Fecha anterior'}
            className={`h-11 w-11 items-center justify-center rounded-xl border ${
              !prevDate
                ? 'border-slate-200 opacity-30 dark:border-slate-800'
                : 'border-slate-200 bg-white active:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:active:bg-slate-800'
            }`}
          >
            <Ionicons
              name="chevron-back"
              size={18}
              color={!prevDate ? '#94a3b8' : '#64748b'}
            />
          </Pressable>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="flex-1"
            contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
          >
            {dates.map((d) => {
              const isActive = d === selectedDate;
              return (
                <Pressable
                  key={d}
                  onPress={() => setSelectedDate(d)}
                  className={`min-h-[38px] justify-center rounded-full px-3.5 py-1.5 ${
                    isActive
                      ? 'bg-rink-passion dark:bg-rose-700'
                      : 'border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                  }`}
                >
                  <Text
                    className={`text-xs font-semibold ${
                      isActive
                        ? 'text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {dayPillLabel(d, locale)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={nextDate ? () => setSelectedDate(nextDate) : undefined}
            disabled={!nextDate}
            accessibilityLabel={t('fixtures.next_date') || 'Fecha siguiente'}
            className={`h-11 w-11 items-center justify-center rounded-xl border ${
              !nextDate
                ? 'border-slate-200 opacity-30 dark:border-slate-800'
                : 'border-slate-200 bg-white active:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:active:bg-slate-800'
            }`}
          >
            <Ionicons
              name="chevron-forward"
              size={18}
              color={!nextDate ? '#94a3b8' : '#64748b'}
            />
          </Pressable>
        </View>
      )}

      {/* Modo: EQUIPO (TeamPicker) */}
      {mode === 'team' && teams.length > 0 && (
        <View className="mx-3 mb-3">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
          >
            {teams.map((tm) => {
              const active = tm.id === selectedTeamId;
              return (
                <Pressable
                  key={tm.id}
                  onPress={() => setSelectedTeamId(active ? null : tm.id)}
                  className={`min-h-[44px] flex-row items-center gap-2 rounded-xl border px-3 py-1.5 ${
                    active
                      ? 'border-rink-passion bg-rink-passion/10 dark:border-rose-600 dark:bg-rose-950/40'
                      : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                  }`}
                >
                  <Avatar
                    uri={teamLogoUri(tm.id, 48)}
                    fallbackUri={tm.logoUrl}
                    name={tm.name}
                    size={22}
                  />
                  <Text
                    numberOfLines={1}
                    className={`text-xs font-semibold ${
                      active
                        ? 'text-rink-passion dark:text-rose-400'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {clubName(tm.shortName ?? tm.name)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Cabecera del equipo seleccionado con contador de partidos */}
          {activeTeam && (
            <View className="mt-2.5 flex-row items-center justify-between rounded-xl border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              <View className="flex-1 flex-row items-center gap-2.5">
                <Avatar
                  uri={teamLogoUri(activeTeam.id, 64)}
                  fallbackUri={activeTeam.logoUrl}
                  name={activeTeam.name}
                  size={28}
                />
                <Text
                  numberOfLines={1}
                  className="flex-1 text-sm font-bold text-slate-900 dark:text-slate-100"
                >
                  {clubName(activeTeam.name)}
                </Text>
              </View>
              <Text className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {filteredMatches.length === 1
                  ? (t('fixtures.match_count_one') || '{n} partido').replace('{n}', '1')
                  : (t('fixtures.match_count_many') || '{n} partidos').replace(
                      '{n}',
                      String(filteredMatches.length),
                    )}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ── Resultados / Lista de partidos con soporte swipe ── */}
      <View {...panResponder.panHandlers}>
        {mode === 'team' && !activeTeam ? (
          <View className="mx-3 rounded-2xl border border-slate-100 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
            <EmptyState
              title={
                t('fixtures.choose_team') ||
                'Elige un equipo para ver todos sus partidos.'
              }
            />
          </View>
        ) : filteredMatches.length === 0 ? (
          <View className="mx-3 rounded-2xl border border-slate-100 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
            <EmptyState
              title={
                t('fixtures.empty') ||
                'No hay partidos programados para esta selección.'
              }
            />
          </View>
        ) : (
          <View className="mx-3 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
            {filteredMatches.map((match, idx) => {
              const isLive = isEffectivelyLive(match.status);
              const isFinished = match.status === 'finished';
              const showScore = isLive || isFinished;
              const ht = match.homeTeam;
              const at = match.awayTeam;
              const isLast = idx === filteredMatches.length - 1;

              return (
                <Pressable
                  key={match.id}
                  onPress={() => router.push(`/match/${match.id}`)}
                  className={`flex-row items-center px-4 py-3 active:bg-slate-50 dark:active:bg-slate-800/60 ${
                    !isLast ? 'border-b border-slate-100 dark:border-slate-800/70' : ''
                  }`}
                >
                  {/* Equipo Local */}
                  <View className="min-w-0 flex-1 flex-row items-center gap-2">
                    <Avatar
                      uri={teamLogoUri(ht.id, 48)}
                      fallbackUri={ht.logoUrl}
                      name={ht.name}
                      size={24}
                    />
                    <Text
                      numberOfLines={1}
                      className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200"
                    >
                      {clubName(ht.shortName ?? ht.name)}
                    </Text>
                  </View>

                  {/* Marcador / Hora */}
                  <View className="min-w-[56px] shrink-0 items-center justify-center gap-0.5 px-2">
                    {showScore ? (
                      <>
                        <Text className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
                          {match.score.home ?? 0} – {match.score.away ?? 0}
                        </Text>
                        {isLive && (
                          <View className="flex-row items-center gap-1">
                            <View className="h-1.5 w-1.5 rounded-full bg-live animate-pulse" />
                            <Text className="text-[10px] font-bold uppercase tracking-wider text-live">
                              {t('match_states.live')}
                            </Text>
                          </View>
                        )}
                        {isFinished && (
                          <Text className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            {t('match_states.final')}
                          </Text>
                        )}
                      </>
                    ) : (
                      <Text className="text-sm font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                        {formatKickoff(match.scheduledAt)}
                      </Text>
                    )}

                    {match.groupName ? (
                      <Text className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                        {t('standings.group')} {match.groupName}
                      </Text>
                    ) : null}
                  </View>

                  {/* Equipo Visitante */}
                  <View className="min-w-0 flex-1 flex-row-reverse items-center gap-2">
                    <Avatar
                      uri={teamLogoUri(at.id, 48)}
                      fallbackUri={at.logoUrl}
                      name={at.name}
                      size={24}
                    />
                    <Text
                      numberOfLines={1}
                      className="flex-1 text-right text-sm font-medium text-slate-800 dark:text-slate-200"
                    >
                      {clubName(at.shortName ?? at.name)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {/* ── Modal de selección de Jornada ── */}
      <Modal
        visible={showRoundModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRoundModal(false)}
      >
        <Pressable
          onPress={() => setShowRoundModal(false)}
          className="flex-1 justify-end bg-black/50"
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="max-h-[70%] rounded-t-3xl bg-white p-4 shadow-xl dark:bg-slate-900"
          >
            {/* Cabecera del modal */}
            <View className="mb-3 flex-row items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <Text className="text-base font-bold text-slate-900 dark:text-slate-100">
                {t('fixtures.by_round') || 'Filtrar por jornada'}
              </Text>
              <Pressable
                onPress={() => setShowRoundModal(false)}
                className="h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800"
              >
                <Ionicons name="close" size={18} color="#64748b" />
              </Pressable>
            </View>

            {/* Lista de rondas seleccionables */}
            <ScrollView showsVerticalScrollIndicator={false} className="divide-y divide-slate-100 dark:divide-slate-800">
              {orderedRounds.map((r) => {
                const sel = roundSelection(r);
                const isSelected = roundSelectionKey(sel) === activeRoundKey;
                const isCurrent = roundSelectionKey(sel) === defaultRoundKey;
                const label = roundLabel(r, t);

                return (
                  <Pressable
                    key={r.id}
                    onPress={() => {
                      setSelectedRound(sel);
                      setShowRoundModal(false);
                    }}
                    className={`min-h-[48px] flex-row items-center justify-between px-3 py-3 active:bg-slate-50 dark:active:bg-slate-800/60 ${
                      isSelected ? 'bg-rink-passion/5 dark:bg-rose-950/20' : ''
                    }`}
                  >
                    <View className="flex-row items-center gap-2 flex-1 pr-2">
                      <Text
                        className={`text-sm ${
                          isSelected
                            ? 'font-bold text-rink-passion dark:text-rose-400'
                            : 'font-medium text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        {label}
                      </Text>
                      {isCurrent ? (
                        <View className="rounded-full bg-rose-100 px-2 py-0.5 dark:bg-rose-950/60">
                          <Text className="text-[10px] font-bold text-rose-800 dark:text-rose-300">
                            {t('fixtures.current_round') || 'Actual'}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {isSelected ? (
                      <Ionicons name="checkmark-circle" size={20} color="#dc2626" />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <AdBanner variant="list" />
    </View>
  );
}
