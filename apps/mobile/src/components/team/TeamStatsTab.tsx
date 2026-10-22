import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { TeamMatchSummary, TeamSeasonStats } from '@/src/lib/api/types';
import { useLocale } from '@/src/i18n/LocaleContext';
import { teamStatsStory, type Record3 } from '@/src/lib/team-stats-story';
import type { TeamResult } from '@/src/lib/team-calendar';

interface Props {
  stats?: TeamSeasonStats | null;
  matches?: TeamMatchSummary[];
  teamId?: string;
}

const RESULT_BG: Record<TeamResult, string> = {
  W: 'bg-emerald-600',
  D: 'bg-slate-400 dark:bg-slate-500',
  L: 'bg-rink-passion',
};

function Chapter({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mx-3 rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 shadow-xs">
      <View className="mb-3 flex-row items-center gap-2">
        <View className="h-5 w-5 items-center justify-center rounded-full bg-slate-900 dark:bg-slate-100">
          <Text className="font-mono text-[10px] font-bold text-white dark:text-slate-900">{n}</Text>
        </View>
        <Text className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

/** Barra horizontal segmentada V / E / D */
function RecordBar({ r, height = 'h-6' }: { r: Record3; height?: string }) {
  const { t } = useLocale();
  const total = r.w + r.d + r.l;
  if (total === 0) {
    return <View className={`${height} rounded-lg bg-slate-100 dark:bg-slate-800`} />;
  }

  const renderSegment = (n: number, k: TeamResult) => {
    if (n <= 0) return null;
    const pct = (n / total) * 100;
    return (
      <View
        key={k}
        style={{ width: `${pct}%` }}
        className={`h-full items-center justify-center ${RESULT_BG[k]}`}
      >
        {pct >= 14 ? (
          <Text className="text-[10px] font-bold text-white">
            {n} {t(`team_calendar.res_${k}`) || k}
          </Text>
        ) : null}
      </View>
    );
  };

  return (
    <View className={`flex-row ${height} gap-0.5 overflow-hidden rounded-lg`}>
      {renderSegment(r.w, 'W')}
      {renderSegment(r.d, 'D')}
      {renderSegment(r.l, 'L')}
    </View>
  );
}

/** Tarjeta de efectividad en bola parada */
function SetPieceCard({
  scored,
  total,
  label,
}: {
  scored: number;
  total: number;
  label: string;
}) {
  const pct = total > 0 ? Math.round((scored / total) * 100) : null;
  const isGood = pct !== null && pct >= 50;

  return (
    <View className="flex-1 items-center rounded-xl bg-slate-50 px-3 py-3 dark:bg-slate-800/60">
      <Text
        className={`font-mono text-xl font-bold tabular-nums ${
          isGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-50'
        }`}
      >
        {pct !== null ? `${pct}%` : '—'}
      </Text>
      <Text className="text-xs font-semibold text-slate-700 dark:text-slate-200 mt-0.5">
        {label}
      </Text>
      <Text className="font-mono text-[10px] tabular-nums text-slate-400 mt-0.5">
        {scored}/{total}
      </Text>
    </View>
  );
}

export function TeamStatsTab({ stats, matches = [], teamId = '' }: Props) {
  const router = useRouter();
  const { t, locale } = useLocale();
  const [showAll, setShowAll] = useState(false);

  const story = useMemo(() => {
    if (!stats || stats.played === 0) return null;
    return teamStatsStory(stats, matches, teamId, { locale });
  }, [stats, matches, teamId, locale]);

  if (!stats || stats.played === 0 || !story) {
    return (
      <View className="mx-3 mt-3 rounded-2xl border border-slate-100 bg-white p-6 items-center dark:border-slate-800 dark:bg-slate-900">
        <Text className="text-sm text-slate-400">
          {t('team.stats_empty') || 'Sense estadístiques per a aquesta temporada'}
        </Text>
      </View>
    );
  }

  const maxPm = Math.max(story.scoring.forPerMatch, story.scoring.againstPerMatch, 1);
  const pctPts = (r: Record3) => {
    const p = r.w + r.d + r.l;
    return p > 0 ? Math.round(((r.w * 3 + r.d) / (p * 3)) * 100) : 0;
  };

  return (
    <View className="space-y-3 mt-3">
      {/* Titular / Kicker de temporada */}
      <View className="mx-3 overflow-hidden rounded-2xl bg-rink-passion p-4 shadow-sm">
        <Text className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/70">
          {t('team_story.kicker') || 'HISTORIA DE LA TEMPORADA'}
        </Text>
        <Text className="mt-1 text-xl font-bold leading-tight text-white">
          {story.headline.title}
        </Text>
        <Text className="mt-0.5 text-xs text-white/80">{story.headline.sub}</Text>

        {story.results.streak.length > 0 ? (
          <View className="mt-3 flex-row gap-1.5">
            {story.results.streak.map((r, i) => (
              <View
                key={i}
                className={`h-6 w-6 items-center justify-center rounded-md border border-white/30 ${
                  r === 'W' ? 'bg-emerald-500' : r === 'L' ? 'bg-black/30' : 'bg-white/20'
                }`}
              >
                <Text className="text-[10px] font-bold text-white">
                  {t(`team_calendar.res_${r}`) || r}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {/* Capítulo 1: Resultados */}
      <Chapter n={1} title={t('team_story.results') || 'Resultados'}>
        <Text className="mb-2.5 text-xs text-slate-700 dark:text-slate-200">
          {story.results.sentence}
        </Text>
        <RecordBar r={story.results.all} />

        <View className="mt-3.5 space-y-2">
          {([['home', story.results.home], ['away', story.results.away]] as const).map(
            ([k, r]) => (
              <View key={k} className="flex-row items-center gap-2">
                <Text className="w-12 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {t(`team_calendar.${k}`) || (k === 'home' ? 'Casa' : 'Fuera')}
                </Text>
                <View className="flex-1">
                  <RecordBar r={r} height="h-3.5" />
                </View>
                <Text className="w-14 text-right font-mono text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
                  {pctPts(r)}% pts
                </Text>
              </View>
            ),
          )}
        </View>

        {story.results.venue ? (
          <View className="mt-3 border-l-2 border-rink-passion pl-2.5">
            <Text className="text-xs font-medium text-slate-800 dark:text-slate-100">
              {story.results.venue}
            </Text>
          </View>
        ) : null}
      </Chapter>

      {/* Capítulo 2: Ataque y Defensa */}
      <Chapter n={2} title={t('team_story.attack_defense') || 'Ataque y defensa'}>
        <View className="space-y-2.5">
          {/* Goles a favor */}
          <View>
            <View className="mb-1 flex-row items-baseline justify-between">
              <Text className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {t('team_story.scored_pm') || 'Goles marcados por partido'}
              </Text>
              <Text className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">
                {story.scoring.forPerMatch.toFixed(1).replace('.', ',')}
              </Text>
            </View>
            <View className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <View
                style={{ width: `${(story.scoring.forPerMatch / maxPm) * 100}%` }}
                className="h-full rounded-full bg-emerald-600"
              />
            </View>
          </View>

          {/* Goles en contra */}
          <View>
            <View className="mb-1 flex-row items-baseline justify-between">
              <Text className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {t('team_story.conceded_pm') || 'Goles encajados por partido'}
              </Text>
              <Text className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">
                {story.scoring.againstPerMatch.toFixed(1).replace('.', ',')}
              </Text>
            </View>
            <View className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <View
                style={{ width: `${(story.scoring.againstPerMatch / maxPm) * 100}%` }}
                className="h-full rounded-full bg-rink-passion"
              />
            </View>
          </View>
        </View>

        <Text className="mt-2.5 text-xs text-slate-700 dark:text-slate-200">
          {story.scoring.sentence}
        </Text>

        {story.scoring.biggestWin ? (
          <Pressable
            onPress={() => router.push(`/match/${story.scoring.biggestWin!.matchId}`)}
            className="mt-2 flex-row items-center gap-1 active:opacity-70"
          >
            <Text className="text-xs font-semibold text-rink-passion dark:text-rose-400">
              {story.scoring.biggestWin.text} →
            </Text>
          </Pressable>
        ) : null}
      </Chapter>

      {/* Capítulo 3: Disciplina */}
      <Chapter n={3} title={t('team.discipline') || 'Disciplina'}>
        <Text className="mb-2.5 text-xs text-slate-700 dark:text-slate-200">
          {story.discipline.sentence}
        </Text>
        <View className="flex-row gap-2 text-center">
          <View className="flex-1 rounded-xl bg-slate-50 px-2 py-2 items-center dark:bg-slate-800/60">
            <Text className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {story.discipline.foulsPerMatch.toFixed(1).replace('.', ',')}
            </Text>
            <Text numberOfLines={1} className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t('team_story.fouls_pm') || 'Faltas/p.'}
            </Text>
          </View>

          <View className="flex-1 rounded-xl bg-slate-50 px-2 py-2 items-center border-t-2 border-blue-500 dark:bg-slate-800/60">
            <Text className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {stats.blueCards}
            </Text>
            <Text numberOfLines={1} className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t('hockey_stats.blue_cards') || 'Azules'}
            </Text>
          </View>

          <View className="flex-1 rounded-xl bg-slate-50 px-2 py-2 items-center border-t-2 border-red-600 dark:bg-slate-800/60">
            <Text className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {stats.redCards}
            </Text>
            <Text numberOfLines={1} className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t('hockey_stats.red_cards') || 'Rojas'}
            </Text>
          </View>

          <View className="flex-1 rounded-xl bg-slate-50 px-2 py-2 items-center dark:bg-slate-800/60">
            <Text className="font-mono text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {stats.timeouts}
            </Text>
            <Text numberOfLines={1} className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t('hockey_stats.time_outs') || 'T. Morts'}
            </Text>
          </View>
        </View>
      </Chapter>

      {/* Capítulo 4: Bola parada */}
      {stats.penalties.total > 0 || stats.directFouls.total > 0 ? (
        <Chapter n={4} title={t('team.set_pieces') || 'Bola parada'}>
          {story.setPieces.sentence ? (
            <Text className="mb-2.5 text-xs text-slate-700 dark:text-slate-200">
              {story.setPieces.sentence}
            </Text>
          ) : null}
          <View className="flex-row gap-2">
            <SetPieceCard
              scored={stats.penalties.scored}
              total={stats.penalties.total}
              label={t('team.penalties') || 'Penaltis'}
            />
            <SetPieceCard
              scored={stats.directFouls.scored}
              total={stats.directFouls.total}
              label={t('team.direct_fouls') || 'Faltas directas'}
            />
          </View>
        </Chapter>
      ) : null}

      {/* Desplegable de cifras en bruto */}
      <View className="items-center py-2">
        <Pressable
          onPress={() => setShowAll((v) => !v)}
          accessibilityRole="button"
          className="flex-row items-center gap-1 active:opacity-70"
        >
          <Text className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t('team_story.more') || 'Ver todas las cifras'} {showAll ? '▲' : '▼'}
          </Text>
        </Pressable>
      </View>

      {showAll ? (
        <View className="mx-3 rounded-2xl border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <View className="flex-row flex-wrap gap-2">
            {([
              [stats.played, t('team.played') || 'PJ'],
              [stats.won, t('team.won') || 'PG'],
              [stats.drawn, t('team.drawn') || 'PE'],
              [stats.lost, t('team.lost') || 'PP'],
              [stats.goalsFor, t('team.goals_for') || 'GF'],
              [stats.goalsAgainst, t('team.goals_against') || 'GC'],
              [stats.assists, t('hockey_stats.assists') || 'Asist.'],
              [stats.teamFouls, t('hockey_stats.team_fouls') || 'Faltes'],
            ] as const).map(([v, l]) => (
              <View
                key={l}
                className="w-[23%] items-center rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60"
              >
                <Text className="font-mono text-sm font-bold tabular-nums text-slate-900 dark:text-slate-50">
                  {v}
                </Text>
                <Text numberOfLines={1} className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {l}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
