import { Text, View } from 'react-native';
import type { MatchDetail } from '@/src/lib/api/types';

const ICON: Record<string, string> = {
  goal: '⚽',
  penalty: '🥅',
  blue_card: '🟦',
  red_card: '🟥',
  timeout: '⏱',
  period_end: '⏸',
};

export function EventRow({ event }: { event: MatchDetail['events'][number] }) {
  const home = event.isHomeTeam;
  return (
    <View className={`mx-3 my-1 flex-row items-center ${home ? '' : 'flex-row-reverse'}`}>
      <View className="w-10 items-center">
        <Text className="text-[10px] text-slate-500">{event.minute != null ? `${event.minute}'` : ''}</Text>
      </View>
      <View className={`flex-1 rounded-lg bg-white px-3 py-2 dark:bg-slate-900 ${home ? 'mr-16' : 'ml-16'}`}>
        <Text className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {ICON[event.eventType] ?? '•'} {event.player ? `${event.player.firstName} ${event.player.lastName}` : (event.detail ?? event.eventType)}
        </Text>
      </View>
    </View>
  );
}
