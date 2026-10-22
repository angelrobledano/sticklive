import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { TeamDetail } from '@/src/lib/api/types';
import { SummaryTab } from './SummaryTab';
import { CalendarTab } from './CalendarTab';
import { SquadTab } from './SquadTab';
import { TeamStatsTab } from './TeamStatsTab';
import { useLocale } from '@/src/i18n/LocaleContext';

export const TEAM_TABS = ['Resumen', 'Calendario', 'Plantilla', 'Estadísticas'] as const;
export type TeamTab = (typeof TEAM_TABS)[number];

const TAB_KEYS: Record<TeamTab, string> = {
  Resumen: 'match_tabs.summary',
  Calendario: 'team.calendar',
  Plantilla: 'team.squad',
  Estadísticas: 'match_tabs.stats',
};

interface Props {
  data: TeamDetail;
}

export function TeamCenterClient({ data }: Props) {
  const [activeTab, setActiveTab] = useState<TeamTab>('Resumen');
  const { t } = useLocale();

  return (
    <View className="mt-3">
      {/* Pestañas de navegación */}
      <View className="flex-row border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3">
        {TEAM_TABS.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              className={`flex-1 items-center py-3 border-b-2 ${
                isActive ? 'border-rink-passion' : 'border-transparent'
              }`}
            >
              <Text
                className={`text-xs ${
                  isActive
                    ? 'font-bold text-rink-passion'
                    : 'font-medium text-slate-500 dark:text-slate-400'
                }`}
              >
                {t(TAB_KEYS[tab])}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Contenido del Tab Activo */}
      {activeTab === 'Resumen' && <SummaryTab data={data} />}
      {activeTab === 'Calendario' && <CalendarTab data={data} />}
      {activeTab === 'Plantilla' && <SquadTab data={data} />}
      {activeTab === 'Estadísticas' && (
        <TeamStatsTab stats={data.stats} matches={data.matches} teamId={data.team.id} />
      )}
    </View>
  );
}
