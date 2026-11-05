import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { HeadToHeadMatch } from '@sports/core/content-summary';
import { clubName } from '@sports/core/names';
import { useLocale } from '@/src/i18n/LocaleContext';

/** Último enfrentamiento entre los dos equipos antes de este (paridad con la web). */
export function PreviousMeeting({ match }: { match: HeadToHeadMatch | null }) {
  const router = useRouter();
  const { t, locale } = useLocale();
  if (!match) return null;
  let date = '';
  if (match.date) {
    try {
      date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(match.date));
    } catch { date = ''; }
  }
  const teams = `${clubName(match.homeName)} - ${clubName(match.awayName)}`;
  const score = `${match.homeScore ?? '-'}-${match.awayScore ?? '-'}`;

  return (
    <View className="mx-3 mt-3 rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <Text accessibilityRole="header" className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {t('match_detail.previous_meeting')}
      </Text>
      <Pressable
        onPress={() => router.push(`/match/${match.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`${teams}, ${score}${date ? `, ${date}` : ''}`}
        className="mt-2 min-h-[44px] flex-row items-center gap-3 active:opacity-70"
      >
        <Text numberOfLines={1} className="min-w-0 flex-1 text-sm text-slate-700 dark:text-slate-200">{teams}</Text>
        <Text className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-50">{score}</Text>
        {date ? <Text className="text-xs text-slate-400">{date}</Text> : null}
      </Pressable>
    </View>
  );
}
