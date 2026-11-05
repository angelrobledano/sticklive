import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { useLocale } from '@/src/i18n/LocaleContext';
import { clubName } from '@/src/lib/names';
import { formatDayLabel, formatKickoff, isEffectivelyLive } from '@/src/lib/time';
import {
  type PlayoffSeries,
  buildSeries,
  gameWinnerId,
  groupByPhase,
  placementMatches,
  seriesWinnerId,
} from '@/src/lib/playoff';
import { PlayoffBracket } from './PlayoffBracket';
import { ChampionBlock } from './ChampionBlock';
import type { SeasonMatch } from '@/src/lib/api/types';

function SeriesCard({
  serie,
  label,
  isFinal = false,
}: {
  serie: PlayoffSeries;
  label: string;
  isFinal?: boolean;
}) {
  const router = useRouter();
  const { t, locale } = useLocale();

  const isSingle = serie.games.length === 1;
  const single = isSingle ? serie.games[0]! : null;
  const championId = isFinal ? seriesWinnerId(serie) : null;

  // Si es a partido único (ej. Final Four o Copa)
  if (isSingle && single) {
    const live = isEffectivelyLive(single.status, single.scheduledAt);
    const isFinished = single.status === 'finished';
    const showScore = isFinished || live;
    const winnerId = isFinished ? gameWinnerId(single) : null;
    const dateLabel = formatDayLabel(single.scheduledAt, locale);
    const when = isFinished
      ? dateLabel
        ? `${t('match_states.final')} · ${dateLabel}`
        : t('match_states.final')
      : live
        ? t('match_states.live')
        : formatKickoff(single.scheduledAt);

    return (
      <Pressable
        onPress={() => router.push(`/match/${single.id}`)}
        className="mb-2.5 overflow-hidden rounded-xl border border-slate-100 bg-white p-3 shadow-xs active:opacity-75 dark:border-slate-800 dark:bg-slate-900"
      >
        <View className="mb-2 flex-row items-center justify-between">
          <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {label}
          </Text>
          <Text
            className={`text-[10px] font-bold uppercase tracking-wider ${
              live ? 'text-emerald-500' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {when}
          </Text>
        </View>

        {[
          { team: single.homeTeam, score: single.score.home },
          { team: single.awayTeam, score: single.score.away },
        ].map(({ team, score }, idx) => {
          const isWinner = showScore && winnerId === team.id;
          return (
            <View
              key={team.id}
              className={`flex-row items-center justify-between py-2 ${
                idx === 0 ? 'border-b border-slate-100 dark:border-slate-800' : ''
              }`}
            >
              <View className="flex-1 flex-row items-center gap-2 pr-2">
                <Avatar uri={teamLogoUri(team.id, 48)} name={team.name} size={22} />
                <Text
                  numberOfLines={1}
                  className={`flex-1 text-sm ${
                    isWinner
                      ? 'font-bold text-slate-900 dark:text-slate-50'
                      : 'font-medium text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {clubName(team.name) || team.shortName || team.name}
                </Text>
                {championId === team.id ? (
                  <View className="flex-row items-center gap-1 rounded-full bg-rink-passion px-2 py-0.5">
                    <Ionicons name="trophy" size={10} color="#ffffff" />
                    <Text className="text-[9px] font-bold uppercase text-white">Campeón</Text>
                  </View>
                ) : null}
              </View>
              {showScore && score != null ? (
                <Text
                  className={`font-mono text-base tabular-nums ${
                    isWinner
                      ? 'font-extrabold text-slate-900 dark:text-slate-50'
                      : 'font-semibold text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {score}
                </Text>
              ) : (
                <Text className="text-xs text-slate-400">vs</Text>
              )}
            </View>
          );
        })}
      </Pressable>
    );
  }

  // Si es a serie de varios partidos (ej. playoffs al mejor de 3 o 5)
  const rows = [
    { team: serie.teamA, wins: serie.winsA, winner: serie.winsA > serie.winsB },
    { team: serie.teamB, wins: serie.winsB, winner: serie.winsB > serie.winsA },
  ];

  return (
    <View className="mb-2.5 overflow-hidden rounded-xl border border-slate-100 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      {/* Cabecera de la serie */}
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {label}
        </Text>
        <Text className="text-[9px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Victorias
        </Text>
      </View>

      {/* Equipos y victorias */}
      {rows.map(({ team, wins, winner }, idx) => {
        const isChampion = championId === team.id;
        return (
          <View
            key={team.id}
            className={`flex-row items-center justify-between py-2 ${
              idx === 0 ? 'border-b border-slate-100 dark:border-slate-800' : ''
            }`}
          >
            <Pressable
              onPress={() => router.push(`/team/${team.id}`)}
              className="flex-1 flex-row items-center gap-2 pr-2 active:opacity-70"
            >
              <Avatar uri={teamLogoUri(team.id, 48)} name={team.name} size={24} />
              <Text
                numberOfLines={1}
                className={`flex-1 text-sm ${
                  winner
                    ? 'font-bold text-slate-900 dark:text-slate-50'
                    : 'font-medium text-slate-700 dark:text-slate-300'
                }`}
              >
                {clubName(team.name) || team.shortName || team.name}
              </Text>
              {isChampion ? (
                <View className="flex-row items-center gap-1 rounded-full bg-rink-passion px-2 py-0.5">
                  <Ionicons name="trophy" size={10} color="#ffffff" />
                  <Text className="text-[9px] font-bold uppercase text-white">Campeón</Text>
                </View>
              ) : null}
            </Pressable>

            {/* Badge de victorias */}
            <View
              className={`h-6 min-w-[24px] items-center justify-center rounded-md px-1.5 ${
                winner
                  ? 'bg-rink-passion dark:bg-accent'
                  : 'bg-slate-100 dark:bg-slate-800'
              }`}
            >
              <Text
                className={`font-mono text-xs font-bold tabular-nums ${
                  winner
                    ? 'text-white dark:text-slate-900'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {wins}
              </Text>
            </View>
          </View>
        );
      })}

      {/* Partidos individuales de la serie (Pills) */}
      <View className="mt-2.5 flex-row flex-wrap gap-1.5 border-t border-slate-100 pt-2.5 dark:border-slate-800">
        {serie.games.map((g, i) => {
          const played = g.status === 'finished' || g.status === 'live';
          const winnerId = played ? gameWinnerId(g) : null;
          const homeAbbr = (g.homeTeam.shortName ?? g.homeTeam.name).slice(0, 4);
          const awayAbbr = (g.awayTeam.shortName ?? g.awayTeam.name).slice(0, 4);

          return (
            <Pressable
              key={g.id}
              onPress={() => router.push(`/match/${g.id}`)}
              className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 active:opacity-70 ${
                g.status === 'live'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/30'
                  : played
                    ? 'bg-slate-100 dark:bg-slate-800'
                    : 'bg-slate-50 dark:bg-slate-800/40'
              }`}
            >
              <Text className="text-[9px] font-bold text-slate-400 dark:text-slate-400">
                {i + 1}
              </Text>
              {played ? (
                <>
                  <Text
                    className={`text-[10px] font-semibold ${
                      winnerId === g.homeTeam.id
                        ? 'font-bold text-slate-900 dark:text-slate-100'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {homeAbbr}
                  </Text>
                  <Text className="font-mono text-[10px] font-bold text-slate-800 dark:text-slate-200">
                    {g.score.home ?? 0}-{g.score.away ?? 0}
                  </Text>
                  <Text
                    className={`text-[10px] font-semibold ${
                      winnerId === g.awayTeam.id
                        ? 'font-bold text-slate-900 dark:text-slate-100'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {awayAbbr}
                  </Text>
                </>
              ) : (
                <Text className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                  {`${homeAbbr} vs ${awayAbbr}`}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function PlayoffsTab({ matches }: { matches: SeasonMatch[] }) {
  const { t } = useLocale();

  const phases = useMemo(() => {
    const byPhase = groupByPhase(matches);
    const placement = placementMatches(matches);
    return {
      Cuartos: buildSeries(byPhase.Cuartos),
      Semis: buildSeries(byPhase.Semis),
      Final: buildSeries(byPhase.Final),
      Placement: buildSeries(placement),
    };
  }, [matches]);

  // Lista de fases disponibles
  const availablePhases = useMemo(() => {
    const list: { key: string; label: string }[] = [];
    if (phases.Cuartos.length > 0) list.push({ key: 'Cuartos', label: 'Cuartos' });
    if (phases.Semis.length > 0) list.push({ key: 'Semis', label: 'Semis' });
    if (phases.Final.length > 0) list.push({ key: 'Final', label: 'Final' });
    if (phases.Placement.length > 0) list.push({ key: 'Placement', label: '9.º-10.º' });
    return list;
  }, [phases]);

  // Fase por defecto: la más avanzada disponible (Final si existe, o Semis, etc.)
  const defaultPhaseKey = useMemo(() => {
    if (phases.Final.length > 0) return 'Final';
    if (phases.Semis.length > 0) return 'Semis';
    if (phases.Cuartos.length > 0) return 'Cuartos';
    if (phases.Placement.length > 0) return 'Placement';
    return availablePhases[0]?.key ?? 'Cuartos';
  }, [phases, availablePhases]);

  const [userSelectedPhase, setUserSelectedPhase] = useState<string | null>(null);

  // La fase activa respeta la selección manual del usuario si existe en las fases de estos partidos;
  // si el usuario no ha seleccionado o la fase ya no existe (ej. cambio de temporada), usa la más avanzada disponible.
  const activePhaseKey = useMemo(() => {
    if (userSelectedPhase && availablePhases.some((p) => p.key === userSelectedPhase)) {
      return userSelectedPhase;
    }
    return defaultPhaseKey;
  }, [userSelectedPhase, availablePhases, defaultPhaseKey]);

  const currentSeries = useMemo(() => {
    if (activePhaseKey === 'Cuartos') return phases.Cuartos;
    if (activePhaseKey === 'Semis') return phases.Semis;
    if (activePhaseKey === 'Final') return phases.Final;
    if (activePhaseKey === 'Placement') return phases.Placement;
    return [];
  }, [phases, activePhaseKey]);

  const activePhaseObj = availablePhases.find((p) => p.key === activePhaseKey);
  const phaseLabel = activePhaseObj ? activePhaseObj.label : activePhaseKey;

  const noDataText = t('playoffs.no_data');
  const emptyMessage =
    noDataText && noDataText !== 'playoffs.no_data'
      ? noDataText
      : 'No hay partidos programados para esta fase';

  const championTeam = useMemo(() => {
    if (phases.Final.length === 0) return null;
    const finalSeries = phases.Final[0];
    if (!finalSeries) return null;
    const winnerId = seriesWinnerId(finalSeries);
    if (!winnerId) return null;
    for (const g of finalSeries.games) {
      if (g.homeTeam.id === winnerId) return g.homeTeam;
      if (g.awayTeam.id === winnerId) return g.awayTeam;
    }
    return null;
  }, [phases.Final]);

  return (
    <View className="px-3 pt-3">
      {/* Campeón si la final ya ha terminado */}
      {championTeam ? <ChampionBlock team={championTeam} /> : null}

      {/* Bracket resumido arriba */}
      <PlayoffBracket matches={matches} />

      {/* Selector de fase si hay más de 1 fase */}
      {availablePhases.length > 1 ? (
        <View className="mb-3 flex-row flex-wrap gap-2">
          {availablePhases.map((phase) => {
            const isSelected = activePhaseKey === phase.key;
            return (
              <Pressable
                key={phase.key}
                onPress={() => setUserSelectedPhase(phase.key)}
                className={`rounded-full px-4 py-1.5 active:opacity-80 ${
                  isSelected
                    ? 'bg-rink-passion dark:bg-accent'
                    : 'border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                }`}
              >
                <Text
                  className={`text-xs font-bold ${
                    isSelected
                      ? 'text-white dark:text-slate-900'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {phase.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Listado de series de la fase seleccionada */}
      {currentSeries.length === 0 ? (
        <View className="rounded-xl bg-white p-6 items-center justify-center dark:bg-slate-900">
          <Text className="text-xs text-slate-500">{emptyMessage}</Text>
        </View>
      ) : (
        currentSeries.map((serie, idx) => (
          <SeriesCard
            key={idx}
            serie={serie}
            label={currentSeries.length > 1 ? `${phaseLabel} · Serie ${idx + 1}` : phaseLabel}
            isFinal={activePhaseKey === 'Final'}
          />
        ))
      )}
    </View>
  );
}
