import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BRAND } from '@sports/brand';
import type { MatchSummary } from '@sports/core/api';
import { useLocale } from '@/src/i18n/LocaleContext';
import { madridDateKey } from '@sports/core/match-time';
import { selectGradaMatches } from '@sports/core/grada';
import { MatchGroupCard } from '@/src/components/home/MatchGroupCard';
import { MatchRow } from '@/src/components/home/MatchRow';

interface Props {
  matches: MatchSummary[];
  teamIds: string[];
  leagueIds: string[];
}

/**
 * «Mi grada» (paridad con la web): próximos partidos y últimos resultados de
 * lo seguido, con las mismas tarjetas y filas de la home, la fecha en cada
 * fila y la competición encima. Vive en Favoritos, nunca en la jornada.
 */
export function MiGrada({ matches, teamIds, leagueIds }: Props) {
  const { t } = useLocale();
  const todayKey = useMemo(() => madridDateKey(new Date().toISOString()), []);
  const { upcoming, results } = useMemo(
    () => selectGradaMatches(matches, { teamIds, leagueIds, todayKey }),
    [matches, teamIds, leagueIds, todayKey],
  );
  const followed = useMemo(() => new Set(teamIds), [teamIds]);

  if (teamIds.length === 0 && leagueIds.length === 0) return null;
  if (upcoming.length === 0 && results.length === 0) return null;

  const star = (
    <View className="h-5 w-5 items-center justify-center">
      <Ionicons name="star" size={13} color={BRAND.granate} />
    </View>
  );
  const rows = (list: MatchSummary[]) =>
    list.map((m) => (
      <MatchRow key={m.id} match={m} followedTeamIds={followed} showDate caption={m.competitionName ?? null} />
    ));

  return (
    <View accessibilityLabel={t('favorites.grada_title')}>
      <Text accessibilityRole="header" className="px-4 pb-1 text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {t('favorites.grada_title')}
      </Text>
      {upcoming.length > 0 ? (
        <MatchGroupCard title={t('favorites.grada_upcoming')} icon={star} count={upcoming.length} collapsible={false}>
          {rows(upcoming)}
        </MatchGroupCard>
      ) : null}
      {results.length > 0 ? (
        <MatchGroupCard title={t('favorites.grada_results')} icon={star} count={results.length} collapsible={false}>
          {rows(results)}
        </MatchGroupCard>
      ) : null}
    </View>
  );
}
