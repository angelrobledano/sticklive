import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocale } from '@/src/i18n/LocaleContext';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { clubName } from '@/src/lib/names';
import type { CompetitionSummaryData } from '@/src/lib/content-summary';

const COPY: Record<string, {
  live: string;
  done: string;
  matchday: (c: number, t: number) => string;
  leader: string;
  finalFirst: string;
  scorer: string;
  goals: string;
  pts: string;
  medals: string;
  gold: string;
  silver: string;
  bronze: string;
}> = {
  es: {
    live: 'Así va la liga', done: 'Así terminó', matchday: (c, t) => `Jornada ${c} de ${t}`,
    leader: 'Líder', finalFirst: '1.º en la clasificación final', scorer: 'Máximo goleador',
    goals: 'goles', pts: 'pts', medals: 'Medallero', gold: 'Oro', silver: 'Plata', bronze: 'Bronce',
  },
  en: {
    live: 'The league so far', done: 'How it ended', matchday: (c, t) => `Matchday ${c} of ${t}`,
    leader: 'Leader', finalFirst: '1st in the final standings', scorer: 'Top scorer',
    goals: 'goals', pts: 'pts', medals: 'Medal table', gold: 'Gold', silver: 'Silver', bronze: 'Bronze',
  },
  pt: {
    live: 'Assim vai a liga', done: 'Assim terminou', matchday: (c, t) => `Jornada ${c} de ${t}`,
    leader: 'Líder', finalFirst: '1.º na classificação final', scorer: 'Melhor marcador',
    goals: 'golos', pts: 'pts', medals: 'Medalheiro', gold: 'Ouro', silver: 'Prata', bronze: 'Bronze',
  },
  fr: {
    live: 'Le championnat en cours', done: 'Bilan de la saison', matchday: (c, t) => `Journée ${c} sur ${t}`,
    leader: 'Leader', finalFirst: '1er du classement final', scorer: 'Meilleur buteur',
    goals: 'buts', pts: 'pts', medals: 'Tableau des médailles', gold: 'Or', silver: 'Argent', bronze: 'Bronze',
  },
  it: {
    live: 'Il campionato finora', done: 'Com’è finita', matchday: (c, t) => `Giornata ${c} di ${t}`,
    leader: 'Capolista', finalFirst: '1º nella classifica finale', scorer: 'Capocannoniere',
    goals: 'gol', pts: 'pt', medals: 'Medagliere', gold: 'Oro', silver: 'Argento', bronze: 'Bronzo',
  },
};

export function CompetitionSummary({
  summary,
}: {
  summary: CompetitionSummaryData;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const c = COPY[locale] ?? COPY.es;

  const { status, leader, topScorer, featured, podium, figures, matchday } = summary;

  // Si no hay datos relevantes, no pintar nada
  if (!leader && !topScorer && !featured && !podium && !figures) {
    return null;
  }

  const isFinished = status === 'finished';
  const title = isFinished ? c.done : c.live;
  const leaderLabel = isFinished ? c.finalFirst : c.leader;

  return (
    <View className="mx-3 mt-3 rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {/* Cabecera del resumen */}
      <View className="flex-row items-center justify-between pb-2">
        <View className="flex-row items-center gap-1.5">
          <Ionicons
            name={isFinished ? 'trophy-outline' : 'stats-chart-outline'}
            size={16}
            color="#ef4444"
          />
          <Text className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {title}
          </Text>
        </View>
        {!isFinished && matchday ? (
          <Text className="text-xs font-semibold text-slate-500 dark:text-slate-300">
            {`Jornada ${matchday.current} de ${matchday.total}`}
          </Text>
        ) : null}
      </View>

      {/* Podio / Medallero si existe (ej. torneos con bronce) */}
      {podium ? (
        <View className="mb-3 rounded-xl border border-amber-200 bg-amber-50/50 p-2.5 dark:border-amber-900/40 dark:bg-amber-950/20">
          <Text className="text-[10px] font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200">
            Medallero
          </Text>
          <View className="mt-1.5 gap-1.5">
            {[
              { pos: '1', label: 'Oro', team: podium.gold, color: 'bg-amber-400 text-amber-950' },
              { pos: '2', label: 'Plata', team: podium.silver, color: 'bg-slate-300 text-slate-900' },
              { pos: '3', label: 'Bronce', team: podium.bronze, color: 'bg-amber-700 text-white' },
            ].map(({ pos, label, team, color }) => (
              <Pressable
                key={pos}
                onPress={() => router.push(`/team/${team.teamId}`)}
                className="flex-row items-center gap-2 active:opacity-70"
              >
                <View className={`h-5 w-5 items-center justify-center rounded-full ${color}`}>
                  <Text className="text-[10px] font-bold">{pos}</Text>
                </View>
                <Avatar
                  uri={teamLogoUri(team.teamId, 48)}
                  name={team.teamName}
                  size={20}
                />
                <Text
                  numberOfLines={1}
                  className="flex-1 text-xs font-semibold text-slate-900 dark:text-slate-100"
                >
                  {clubName(team.teamName)}
                </Text>
                <Text className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* Tarjetas destacadas (Scroll horizontal) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingBottom: 2 }}
      >
        {/* Card Líder / 1.º en la clasificación final */}
        {leader ? (
          <Pressable
            onPress={() => router.push(`/team/${leader.teamId}`)}
            className="w-56 rounded-xl border border-slate-100 bg-slate-50/70 p-3 active:opacity-70 dark:border-slate-800 dark:bg-slate-800/60"
          >
            <Text
              numberOfLines={1}
              className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300"
            >
              {leaderLabel}
            </Text>
            <View className="mt-2 flex-row items-center gap-2">
              <Avatar
                uri={teamLogoUri(leader.teamId, 64)}
                name={leader.teamName}
                size={28}
              />
              <Text
                numberOfLines={1}
                className="flex-1 text-sm font-bold text-slate-900 dark:text-slate-100"
              >
                {clubName(leader.teamName)}
              </Text>
            </View>
            <View className="mt-2 flex-row items-baseline gap-1">
              <Text className="font-mono text-xl font-extrabold text-slate-900 dark:text-slate-100">
                {leader.points}
              </Text>
              <Text className="text-xs font-semibold text-slate-500 dark:text-slate-300">pts</Text>
            </View>
            {leader.gap !== null && leader.secondTeamName ? (
              <Text numberOfLines={1} className="mt-0.5 text-xs text-slate-500 dark:text-slate-300">
                {leader.gap > 0
                  ? `+${leader.gap} sobre ${clubName(leader.secondTeamName)}`
                  : `Empatado con ${clubName(leader.secondTeamName)}`}
              </Text>
            ) : null}
          </Pressable>
        ) : null}

        {/* Card Máximo Goleador */}
        {topScorer ? (
          <Pressable
            onPress={() => (topScorer.playerId ? router.push(`/player/${topScorer.playerId}`) : null)}
            className="w-56 rounded-xl border border-slate-100 bg-slate-50/70 p-3 active:opacity-70 dark:border-slate-800 dark:bg-slate-800/60"
          >
            <Text
              numberOfLines={1}
              className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300"
            >
              Máximo goleador
            </Text>
            <View className="mt-2 flex-row items-center gap-2">
              <Avatar
                uri={topScorer.photoUrl}
                name={topScorer.displayName}
                size={28}
                variant="player"
              />
              <View className="flex-1">
                <Text
                  numberOfLines={1}
                  className="text-sm font-bold text-slate-900 dark:text-slate-100"
                >
                  {topScorer.displayName}
                </Text>
                {topScorer.teamName ? (
                  <Text numberOfLines={1} className="text-[10px] text-slate-500 dark:text-slate-300">
                    {clubName(topScorer.teamName)}
                  </Text>
                ) : null}
              </View>
            </View>
            <View className="mt-2 flex-row items-baseline gap-1">
              <Text className="font-mono text-xl font-extrabold text-slate-900 dark:text-slate-100">
                {topScorer.value}
              </Text>
              <Text className="text-xs font-semibold text-slate-500 dark:text-slate-300">goles</Text>
            </View>
            {topScorer.gap !== null ? (
              <Text numberOfLines={1} className="mt-0.5 text-xs text-slate-500 dark:text-slate-300">
                {topScorer.gap > 0
                  ? topScorer.secondName
                    ? `+${topScorer.gap} sobre ${topScorer.secondName}`
                    : `+${topScorer.gap} sobre el 2.º`
                  : 'Empatado con el 2.º'}
              </Text>
            ) : null}
          </Pressable>
        ) : null}

        {/* Card Partido Destacado (si en curso) */}
        {featured ? (
          <Pressable
            onPress={() => router.push(`/match/${featured.id}`)}
            className="w-56 rounded-xl border border-slate-100 bg-slate-50/70 p-3 active:opacity-70 dark:border-slate-800 dark:bg-slate-800/60"
          >
            <Text
              numberOfLines={1}
              className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300"
            >
              Partido destacado
            </Text>
            <View className="mt-2 gap-1.5">
              <View className="flex-row items-center gap-1.5">
                <Avatar
                  uri={teamLogoUri(featured.homeTeamId, 48)}
                  name={featured.homeName}
                  size={18}
                />
                <Text
                  numberOfLines={1}
                  className="flex-1 text-xs font-semibold text-slate-900 dark:text-slate-100"
                >
                  {clubName(featured.homeName)}
                </Text>
              </View>
              <View className="flex-row items-center gap-1.5">
                <Avatar
                  uri={teamLogoUri(featured.awayTeamId, 48)}
                  name={featured.awayName}
                  size={18}
                />
                <Text
                  numberOfLines={1}
                  className="flex-1 text-xs font-semibold text-slate-900 dark:text-slate-100"
                >
                  {clubName(featured.awayName)}
                </Text>
              </View>
            </View>
            <Text className="mt-2 text-[10px] font-semibold text-slate-500 dark:text-slate-300">
              {featured.roundNumber ? `Jornada ${featured.roundNumber}` : 'Próximo partido'}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* Cifras / Métricas */}
      {figures ? (
        <View className="mt-3 flex-row flex-wrap gap-1.5">
          <View className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
            <Text className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
              {`${figures.matchesPlayed} partidos`}
            </Text>
          </View>
          {figures.goalsPerMatch !== null ? (
            <View className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
              <Text className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                {`${figures.goalsPerMatch} goles/partido`}
              </Text>
            </View>
          ) : null}
          {figures.homeWinPct !== null ? (
            <View className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
              <Text className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                {`${figures.homeWinPct}% victorias locales`}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
