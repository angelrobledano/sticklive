import { Pressable, Text, View } from 'react-native';
import { BRAND } from '@sports/brand';
import { useLocale } from '@/src/i18n/LocaleContext';
import type { Tab } from '@/src/lib/match-helpers';

interface MatchTabsProps {
  tabs: Tab[];
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}

const TAB_I18N: Record<Tab, string> = {
  Resumen: 'match_tabs.summary',
  Alineaciones: 'match_tabs.lineups',
  Estadísticas: 'match_tabs.stats',
};

export function MatchTabs({ tabs, activeTab, onChange }: MatchTabsProps) {
  const { t } = useLocale();

  if (tabs.length <= 1) return null;

  return (
    <View className="mx-3 my-3 flex-row rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800">
      {tabs.map((tab) => {
        const isActive = tab === activeTab;
        return (
          <Pressable
            key={tab}
            onPress={() => onChange(tab)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            className={`flex-1 items-center justify-center rounded-lg py-2 transition-all ${
              isActive ? 'bg-white shadow-sm dark:bg-slate-900' : 'active:opacity-70'
            }`}
          >
            <Text
              style={{ color: isActive ? BRAND.granate : undefined }}
              className={`text-xs font-bold ${
                isActive
                  ? 'text-rink-passion dark:text-rose-400'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {t(TAB_I18N[tab])}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
