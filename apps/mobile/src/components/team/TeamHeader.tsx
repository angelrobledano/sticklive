import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { TeamDetail, TeamMatchSummary } from '@/src/lib/api/types';
import { Avatar, teamLogoUri } from '@/src/components/shared/Avatar';
import { FollowButton } from '@/src/components/favorite/FollowButton';
import { clubName } from '@/src/lib/names';
import { useLocale } from '@/src/i18n/LocaleContext';
import { seasonOptionLabel, sectionBadgeText } from '@/src/lib/team-section';

interface Props {
  data: TeamDetail;
  selectedSeasonId?: string;
  onSelectSeason: (seasonId: string) => void;
}

function FormBadge({
  result,
  match,
  currentTeamId,
}: {
  result: string;
  match?: TeamMatchSummary;
  currentTeamId?: string;
}) {
  const { t } = useLocale();
  const router = useRouter();

  const map: Record<string, { bg: string; label: string; desc: string }> = {
    W: { bg: 'bg-emerald-500', label: t('team.form_w') || 'V', desc: 'Victoria' },
    D: { bg: 'bg-slate-400 dark:bg-slate-500', label: t('team.form_d') || 'E', desc: 'Empate' },
    L: { bg: 'bg-red-500', label: t('team.form_l') || 'D', desc: 'Derrota' },
  };
  const { bg, label, desc } = map[result] ?? { bg: 'bg-slate-300 dark:bg-slate-600', label: '?', desc: '' };

  const isHome = match?.homeTeam?.id === currentTeamId;
  const opponent = match ? (isHome ? match.awayTeam?.name : match.homeTeam?.name) : undefined;
  const opponentName = opponent ? clubName(opponent) : undefined;
  const scoreText = match?.score?.home != null ? `${match.score.home}-${match.score.away}` : undefined;

  const a11y = match && opponentName
    ? `${desc}${scoreText ? ` ${scoreText}` : ''} vs ${opponentName}. Pulsa para abrir el partido.`
    : label;

  if (match?.id) {
    return (
      <Pressable
        onPress={() => router.push(`/match/${match.id}`)}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        className={`h-7 w-7 rounded-full ${bg} items-center justify-center active:opacity-75 shadow-2xs`}
      >
        <Text className="text-xs font-bold text-white">{label}</Text>
      </Pressable>
    );
  }

  return (
    <View className={`h-7 w-7 rounded-full ${bg} items-center justify-center`}>
      <Text className="text-xs font-bold text-white">{label}</Text>
    </View>
  );
}

export function TeamHeader({ data, selectedSeasonId, onSelectSeason }: Props) {
  const { team, standing, seasons = [] } = data;
  const { t } = useLocale();
  const router = useRouter();
  const [seasonModalOpen, setSeasonModalOpen] = useState(false);

  const displayName = clubName(team.name) || team.shortName || team.name;
  const section = sectionBadgeText(team, t);
  const form = (standing?.form ?? []).slice(-5);

  const finishedMatches = useMemo(
    () =>
      (data.matches ?? [])
        .filter((m) => m.status === 'finished')
        .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '')),
    [data.matches],
  );
  const formMatches = useMemo(
    () => finishedMatches.slice(-form.length),
    [finishedMatches, form.length],
  );

  const currentSeason = seasons.find((s) => s.id === (selectedSeasonId || data.selectedSeasonId)) ?? seasons[0];

  return (
    <View className="mx-3 mt-2 rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 flex-row items-center gap-3.5 pr-2">
          <Avatar uri={teamLogoUri(team.id, 192)} name={displayName} size={68} />
          <View className="flex-1 min-w-0">
            <Text numberOfLines={2} className="text-lg font-bold leading-tight text-slate-900 dark:text-slate-50">
              {displayName}
            </Text>
            {section ? (
              <View className="mt-1 self-start rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                <Text className="text-[11px] font-medium text-slate-600 dark:text-slate-300">{section}</Text>
              </View>
            ) : null}
            {team.city ? (
              <Text className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{team.city}</Text>
            ) : null}
            {standing?.competitionId ? (
              <Pressable
                onPress={() => router.push(`/competition/${standing.competitionId}`)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={standing.competitionShort ?? standing.competitionName}
                accessibilityHint="Navega a la competició"
                className="mt-1 active:opacity-70"
              >
                <Text numberOfLines={1} className="text-xs font-semibold text-rink-passion">
                  {standing.competitionShort ?? standing.competitionName}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View className="flex-row items-center">
          <FollowButton kind="team" refId={team.id} name={team.name} />
        </View>
      </View>

      {/* Selector de temporada */}
      {seasons.length > 1 ? (
        <View className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <Pressable
            onPress={() => setSeasonModalOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`${t('team.season') || 'Temporada'}: ${currentSeason ? seasonOptionLabel(currentSeason, t) : '—'}`}
            accessibilityHint="Obre el selector de temporades"
            className="flex-row items-center justify-between rounded-xl bg-slate-50 px-3 py-2 active:bg-slate-100 dark:bg-slate-800/60 dark:active:bg-slate-800"
          >
            <View className="flex-1 pr-2">
              <Text className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-400 font-bold">
                {t('team.season') || 'Temporada'}
              </Text>
              <Text numberOfLines={1} className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                {currentSeason ? seasonOptionLabel(currentSeason, t) : '—'}
              </Text>
            </View>
            <Ionicons name="chevron-down" size={14} color="#94a3b8" />
          </Pressable>
        </View>
      ) : null}

      {/* Racha de últimos resultados con enlace directo al partido */}
      {form.length > 0 ? (
        <View className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <Text className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {t('team.last_results') || 'Últims resultats'}
          </Text>
          <View className="flex-row gap-2">
            {form.map((res, i) => (
              <FormBadge
                key={i}
                result={res}
                match={formMatches[i]}
                currentTeamId={team.id}
              />
            ))}
          </View>
        </View>
      ) : null}

      {/* Modal selector de temporada */}
      <Modal visible={seasonModalOpen} transparent animationType="fade" onRequestClose={() => setSeasonModalOpen(false)}>
        <View className="flex-1 justify-end bg-black/60">
          <Pressable className="flex-1" onPress={() => setSeasonModalOpen(false)} accessibilityLabel="Tancar" />
          <View className="max-h-[70%] rounded-t-3xl bg-white p-5 dark:bg-slate-900">
            <View className="flex-row items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <Text className="text-base font-bold text-slate-900 dark:text-slate-100">
                {t('team.season') || 'Temporada'}
              </Text>
              <Pressable
                onPress={() => setSeasonModalOpen(false)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Tancar selector"
                className="h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800"
              >
                <Ionicons name="close" size={18} color="#64748b" />
              </Pressable>
            </View>
            <ScrollView className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {seasons.map((s) => {
                const isSelected = s.id === (currentSeason?.id);
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => {
                      onSelectSeason(s.id);
                      setSeasonModalOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={seasonOptionLabel(s, t)}
                    accessibilityState={{ selected: isSelected }}
                    className={`flex-row items-center justify-between py-3.5 px-3 rounded-xl ${
                      isSelected ? 'bg-rink-passion/10 dark:bg-rink-passion/20' : 'active:bg-slate-50 dark:active:bg-slate-800'
                    }`}
                  >
                    <Text
                      numberOfLines={1}
                      className={`flex-1 text-sm ${
                        isSelected
                          ? 'font-bold text-rink-passion'
                          : 'font-medium text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {seasonOptionLabel(s, t)}
                    </Text>
                    {isSelected ? <Ionicons name="checkmark" size={18} color="#0284c7" /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
