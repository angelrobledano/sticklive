import { Text, View } from 'react-native';
import { useLocale } from '@/src/i18n/LocaleContext';

export interface ShootoutKick {
  player: string;
  scored: boolean;
}

export interface PenaltyShootoutProps {
  shootout: {
    home: ShootoutKick[];
    away: ShootoutKick[];
  };
  homeName: string;
  awayName: string;
}

export function PenaltyShootout({ shootout, homeName, awayName }: PenaltyShootoutProps) {
  const { t } = useLocale();

  const renderKick = (k: ShootoutKick, right = false) => (
    <View
      className={`my-1 flex-row items-center gap-1.5 ${right ? 'flex-row-reverse justify-start' : 'justify-start'}`}
    >
      <View
        className={`h-5 w-5 items-center justify-center rounded-full shrink-0 ${
          k.scored ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
        }`}
      >
        <Text
          className={`text-xs font-black ${
            k.scored ? 'text-white' : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          {k.scored ? '✓' : '✗'}
        </Text>
      </View>
      <Text
        className={`text-xs flex-1 ${right ? 'text-right' : 'text-left'} ${
          k.scored
            ? 'font-bold text-slate-900 dark:text-slate-100'
            : 'text-slate-500 dark:text-slate-400'
        }`}
        numberOfLines={1}
      >
        {k.player}
      </Text>
    </View>
  );

  return (
    <View className="mt-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
      <Text className="mb-2 text-center text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {t('match_states.penalties_label')}
      </Text>
      <View className="flex-row gap-3">
        {/* Columna Local */}
        <View className="flex-1 min-w-0">
          <Text
            className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
            numberOfLines={1}
          >
            {homeName}
          </Text>
          {shootout.home.map((k, i) => (
            <View key={`home-kick-${i}`}>{renderKick(k, false)}</View>
          ))}
        </View>

        {/* Separador vertical */}
        <View className="w-px bg-slate-200 dark:bg-slate-700" />

        {/* Columna Visitante */}
        <View className="flex-1 min-w-0">
          <Text
            className="mb-1.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
            numberOfLines={1}
          >
            {awayName}
          </Text>
          {shootout.away.map((k, i) => (
            <View key={`away-kick-${i}`}>{renderKick(k, true)}</View>
          ))}
        </View>
      </View>
    </View>
  );
}
