import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { TeamDetail, TeamMatchSummary } from '@sports/core/api';
import { buildKnockoutSummary, isKnockoutSeason, knockoutPhaseLabel } from '@sports/core/knockout';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { useLocale } from '@/src/i18n/LocaleContext';
import { clubName } from '@sports/core/names';
import {
  calendarCounts,
  filterTeamMatches,
  teamResult,
  type CalendarFilter,
  type TeamResult,
} from '@sports/core/team-calendar';

interface Props {
  data: TeamDetail;
}

const RESULT_STYLE: Record<TeamResult, { bg: string; text: string }> = {
  W: { bg: 'bg-emerald-600', text: 'text-white' },
  D: { bg: 'bg-slate-400 dark:bg-slate-500', text: 'text-white' },
  L: { bg: 'bg-rink-passion', text: 'text-white' },
};

function upperFirst(s: string) {
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

/**
 * Fila del calendario: jornada y fecha a la izquierda, los dos equipos con su
 * escudo (local arriba, como en un marcador) y el resultado del equipo a la
 * derecha. Sin "@"/"vs": el orden vertical ya indica local y visitante.
 */
function CalendarRow({
  match,
  teamId,
  roundLabel,
}: {
  match: TeamMatchSummary;
  teamId: string;
  roundLabel: string | null;
}) {
  const router = useRouter();
  const { t, locale } = useLocale();

  const tz = match.competitionTimezone ?? 'Europe/Madrid';
  const when = match.scheduledAt ?? match.finishedAt;
  const date = when ? new Date(when) : null;
  const isLive = match.status === 'live';
  const showScore = match.status === 'finished' || isLive;
  const result = teamResult(teamId, match);

  const day = date
    ? date.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: tz }).replace('.', '')
    : '—';
  const weekday = date
    ? date.toLocaleDateString(locale, { weekday: 'short', timeZone: tz }).replace('.', '')
    : '';
  const hour = date
    ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz })
    : '';

  const renderTeamSide = (team: TeamMatchSummary['homeTeam'], score: number | null) => {
    const isMe = team.id === teamId;
    return (
      <View className="flex-row items-center gap-2">
        <Avatar
          uri={teamLogoUri(team.id, 48)}
          fallbackUri={team.logoUrl}
          name={team.name}
          size={20}
        />
        <Text
          numberOfLines={1}
          className={`flex-1 text-xs ${
            isMe
              ? 'font-bold text-slate-900 dark:text-slate-50'
              : 'font-medium text-slate-600 dark:text-slate-300'
          }`}
        >
          {clubName(team.name) || team.shortName || team.name}
        </Text>
        {showScore && (
          <Text
            className={`font-mono text-sm tabular-nums ${
              isMe
                ? 'font-bold text-slate-900 dark:text-slate-50'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {score ?? 0}
          </Text>
        )}
      </View>
    );
  };

  return (
    <Pressable
      onPress={() => router.push(`/match/${match.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${match.homeTeam.name} vs ${match.awayTeam.name}`}
      className="flex-row items-center gap-3 px-3 py-2.5 active:bg-slate-50 dark:active:bg-slate-800/60"
    >
      {/* Cuándo: jornada, día y hora */}
      <View className="w-14 shrink-0 flex-col justify-center border-r border-slate-100 pr-2 dark:border-slate-800">
        {roundLabel ? (
          <Text
            numberOfLines={1}
            className="text-[9px] font-bold uppercase tracking-wide text-rink-passion dark:text-rose-400"
          >
            {roundLabel}
          </Text>
        ) : null}
        <Text className="text-xs font-semibold text-slate-800 dark:text-slate-100">{day}</Text>
        <Text className="text-[10px] text-slate-400 dark:text-slate-400">
          {showScore ? weekday : `${weekday} ${hour}`}
        </Text>
      </View>

      {/* Quién: local arriba, visitante abajo */}
      <View className="flex-1 min-w-0 justify-center gap-1">
        {renderTeamSide(match.homeTeam, match.score.home)}
        {renderTeamSide(match.awayTeam, match.score.away)}
      </View>

      {/* Cómo acabó / Estado */}
      <View className="w-8 shrink-0 items-center justify-center">
        {isLive ? (
          <View className="relative h-2.5 w-2.5 items-center justify-center">
            <View className="absolute h-2.5 w-2.5 rounded-full bg-red-400 opacity-75" />
            <View className="h-2 w-2 rounded-full bg-red-600" />
          </View>
        ) : result ? (
          <View
            className={`h-6 w-6 items-center justify-center rounded-md ${RESULT_STYLE[result].bg}`}
          >
            <Text className={`text-[10px] font-bold ${RESULT_STYLE[result].text}`}>
              {t(`team_calendar.res_${result}`) || result}
            </Text>
          </View>
        ) : (
          <Text className="font-mono text-xs font-semibold tabular-nums text-slate-400 dark:text-slate-400">
            {hour}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function Chip({
  active,
  onPress,
  children,
  count,
}: {
  active: boolean;
  onPress: () => void;
  children: string;
  count?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={`flex-row items-center gap-1 rounded-full px-3 py-1.5 border ${
        active
          ? 'border-slate-900 bg-slate-900 dark:border-slate-100 dark:bg-slate-100'
          : 'border-slate-200 bg-white active:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:active:bg-slate-800'
      }`}
    >
      <Text
        className={`text-xs font-semibold ${
          active ? 'text-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-300'
        }`}
      >
        {children}
      </Text>
      {count != null ? (
        <Text
          className={`text-[10px] font-bold tabular-nums ${
            active ? 'text-white/70 dark:text-slate-900/70' : 'text-slate-400'
          }`}
        >
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function CalendarTab({ data }: Props) {
  const { t, locale } = useLocale();
  const { matches, team, season, standing } = data;

  const [filter, setFilter] = useState<Required<CalendarFilter>>({
    status: 'all',
    venue: 'all',
    result: 'all',
  });

  const koSeason = isKnockoutSeason(season, standing, matches);
  const koSummary = useMemo(
    () => (koSeason ? buildKnockoutSummary(team.id, data.knockoutMatches ?? matches) : null),
    [koSeason, team.id, data.knockoutMatches, matches],
  );

  const counts = useMemo(() => calendarCounts(matches, team.id), [matches, team.id]);
  const visibleMatches = useMemo(
    () => filterTeamMatches(matches, team.id, filter),
    [matches, team.id, filter],
  );

  const set = (patch: Partial<CalendarFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const dirty = filter.status !== 'all' || filter.venue !== 'all' || filter.result !== 'all';

  if (matches.length === 0) {
    return (
      <View className="mx-3 mt-3 rounded-2xl border border-slate-100 bg-white p-6 items-center dark:border-slate-800 dark:bg-slate-900">
        <Text className="text-sm text-slate-400">
          {t('team.no_season_matches') || 'Sense partits per a aquesta temporada'}
        </Text>
      </View>
    );
  }

  // Agrupación por mes (anclada para consistencia)
  const groups = new Map<string, TeamMatchSummary[]>();
  for (const m of visibleMatches) {
    const date = new Date(m.scheduledAt ?? m.finishedAt ?? '');
    const key = isNaN(date.getTime())
      ? (t('team.no_date') || 'Sense data')
      : upperFirst(
          date.toLocaleDateString(locale, {
            month: 'long',
            year: 'numeric',
            timeZone: 'Europe/Madrid',
          }),
        );
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  return (
    <View className="space-y-3 mt-3">
      {/* Barra de Filtros */}
      <View className="mx-3 space-y-2">
        {/* Fila 1: Estado (Todos, Jugados, Próximos) */}
        <View className="flex-row flex-wrap gap-1.5">
          <Chip
            active={filter.status === 'all'}
            onPress={() => set({ status: 'all' })}
            count={counts.all}
          >
            {t('team_calendar.all') || 'Todos'}
          </Chip>
          <Chip
            active={filter.status === 'played'}
            onPress={() => set({ status: 'played' })}
            count={counts.played}
          >
            {t('team_calendar.played') || 'Jugados'}
          </Chip>
          <Chip
            active={filter.status === 'upcoming'}
            onPress={() => set({ status: 'upcoming', result: 'all' })}
            count={counts.upcoming}
          >
            {t('team_calendar.upcoming') || 'Próximos'}
          </Chip>
        </View>

        {/* Fila 2: Sede (Casa / Fuera) y Resultados (V / E / D) */}
        <View className="flex-row flex-wrap items-center gap-1.5">
          <Chip
            active={filter.venue === 'home'}
            onPress={() => set({ venue: filter.venue === 'home' ? 'all' : 'home' })}
            count={counts.home}
          >
            {t('team_calendar.home') || 'Casa'}
          </Chip>
          <Chip
            active={filter.venue === 'away'}
            onPress={() => set({ venue: filter.venue === 'away' ? 'all' : 'away' })}
            count={counts.away}
          >
            {t('team_calendar.away') || 'Fuera'}
          </Chip>

          {filter.status !== 'upcoming' && counts.W + counts.D + counts.L > 0 ? (
            <>
              <View className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-slate-700" />
              {(['W', 'D', 'L'] as const).map((r) => (
                <Pressable
                  key={r}
                  onPress={() => set({ result: filter.result === r ? 'all' : r })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter.result === r }}
                  className={`flex-row items-center gap-1 rounded-full border py-1 pl-1 pr-2 ${
                    filter.result === r
                      ? 'border-slate-900 bg-slate-100 dark:border-slate-100 dark:bg-slate-800'
                      : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
                  }`}
                >
                  <View
                    className={`h-4 w-4 items-center justify-center rounded-full ${RESULT_STYLE[r].bg}`}
                  >
                    <Text className="text-[9px] font-bold text-white">
                      {t(`team_calendar.res_${r}`) || r}
                    </Text>
                  </View>
                  <Text className="text-[10px] font-bold tabular-nums text-slate-700 dark:text-slate-300">
                    {counts[r]}
                  </Text>
                </Pressable>
              ))}
            </>
          ) : null}
        </View>
      </View>

      {/* Partidos agrupados o estado vacío de filtro */}
      {visibleMatches.length === 0 ? (
        <View className="mx-3 rounded-2xl border border-slate-100 bg-white p-6 items-center dark:border-slate-800 dark:bg-slate-900">
          <Text className="text-sm text-slate-400">
            {t('team_calendar.no_matches') || 'No hay partidos con estos filtros.'}
          </Text>
          {dirty ? (
            <Pressable
              onPress={() => setFilter({ status: 'all', venue: 'all', result: 'all' })}
              className="mt-2"
            >
              <Text className="text-xs font-bold text-rink-passion dark:text-rose-400">
                {t('team_calendar.clear') || 'Limpiar filtros'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        Array.from(groups.entries()).map(([month, groupMatches]) => (
          <View
            key={month}
            className="mx-3 overflow-hidden rounded-2xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900"
          >
            <View className="px-3.5 pt-3 pb-1.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
              <Text className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                {month}
              </Text>
            </View>
            <View className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {groupMatches.map((m) => {
                const phaseView = koSummary?.phaseByMatch.get(m.id);
                const roundLabel = phaseView
                  ? knockoutPhaseLabel(phaseView, t)
                  : m.roundName
                  ? m.roundName
                  : m.roundNumber
                  ? `${t('competition.round') || 'J'} ${m.roundNumber}`
                  : null;

                return (
                  <CalendarRow
                    key={m.id}
                    match={m}
                    teamId={team.id}
                    roundLabel={roundLabel}
                  />
                );
              })}
            </View>
          </View>
        ))
      )}
    </View>
  );
}
