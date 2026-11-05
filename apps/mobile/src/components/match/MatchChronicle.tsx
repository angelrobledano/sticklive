import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { ChronicleFact } from '@sports/core/match-chronicle';
import { useLocale } from '@/src/i18n/LocaleContext';
import { chronicleSegments } from '@/src/lib/chronicle-text';

/**
 * Crónica de datos de un partido terminado (paridad con la web
 * MatchChronicle): solo hechos del acta, equipos y jugadores enlazados.
 */
export function MatchChronicle({ facts, teams }: { facts: ChronicleFact[]; teams: Record<string, string> }) {
  const router = useRouter();
  const { t } = useLocale();
  if (facts.length === 0) return null;

  return (
    <View className="mx-3 mt-3 rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <Text accessibilityRole="header" className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {t('match_chronicle.title')}
      </Text>
      <View className="gap-1.5">
        {facts.map((f, i) => (
          <Text key={i} className="text-sm leading-5 text-slate-700 dark:text-slate-300">
            {chronicleSegments(f, t, teams).map((s, j) => {
              const href = s.teamId ? `/team/${s.teamId}` : s.playerId ? `/player/${s.playerId}` : null;
              return href ? (
                <Text
                  key={j}
                  onPress={() => router.push(href)}
                  accessibilityRole="link"
                  className="font-semibold text-slate-900 underline dark:text-slate-100"
                >
                  {s.text}
                </Text>
              ) : (
                <Text key={j}>{s.text}</Text>
              );
            })}
          </Text>
        ))}
      </View>
    </View>
  );
}
