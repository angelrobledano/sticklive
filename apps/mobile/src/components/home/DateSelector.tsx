import { useEffect, useMemo, useRef } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useLocale } from '@/src/i18n/LocaleContext';
import {
  buildDateKeys,
  dayAbbr,
  getRelativeKey,
  labelDate,
  madridTodayKey,
  monthAbbr,
} from '@/src/lib/day-view';

interface DateSelectorProps {
  selected: string;
  onSelect: (dateKey: string) => void;
  markedDays?: ReadonlySet<string>;
}

const ITEM_WIDTH = 58;
const ITEM_MARGIN = 6;
const TOTAL_ITEM_WIDTH = ITEM_WIDTH + ITEM_MARGIN;

export function DateSelector({ selected, onSelect, markedDays }: DateSelectorProps) {
  const { t, locale } = useLocale();
  const todayKey = madridTodayKey();
  const listRef = useRef<FlatList<string>>(null);
  const dateKeys = useMemo(() => buildDateKeys(todayKey, 7, 14), [todayKey]);

  const selectedIndex = Math.max(0, dateKeys.indexOf(selected));

  useEffect(() => {
    if (selectedIndex >= 0) {
      listRef.current?.scrollToIndex({
        index: selectedIndex,
        animated: true,
        viewPosition: 0.5,
      });
    }
  }, [selectedIndex]);

  return (
    <View className="border-b border-slate-200 bg-white py-2 dark:border-slate-800 dark:bg-slate-900">
      <FlatList
        ref={listRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        data={dateKeys}
        keyExtractor={(k) => k}
        getItemLayout={(_, index) => ({
          length: TOTAL_ITEM_WIDTH,
          offset: TOTAL_ITEM_WIDTH * index,
          index,
        })}
        initialScrollIndex={selectedIndex > 0 ? selectedIndex : undefined}
        onScrollToIndexFailed={() => {
          // Fallback silencioso si el layout no ha terminado de medir
        }}
        contentContainerStyle={{ paddingHorizontal: 12 }}
        renderItem={({ item: key }) => {
          const isActive = key === selected;
          const date = labelDate(key);
          const relKey = getRelativeKey(key, todayKey);
          const relLabel = relKey ? t(relKey) : null;
          const hasMatches = markedDays?.has(key) ?? false;

          return (
            <Pressable
              onPress={() => onSelect(key)}
              style={{ width: ITEM_WIDTH, marginRight: ITEM_MARGIN }}
              className={`items-center justify-center rounded-xl py-1.5 ${
                isActive
                  ? 'border border-rink-passion/40 bg-rink-passion/10 dark:border-rink-accent/40 dark:bg-rose-950/40'
                  : 'bg-transparent'
              }`}
            >
              <Text
                className={`text-[10px] font-semibold uppercase ${
                  isActive
                    ? 'text-rink-passion dark:text-rink-accent'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
                numberOfLines={1}
              >
                {relLabel ?? dayAbbr(date, locale)}
              </Text>
              <Text
                className={`text-base font-bold leading-tight ${
                  isActive
                    ? 'text-rink-passion dark:text-rink-accent'
                    : 'text-slate-800 dark:text-slate-200'
                }`}
              >
                {date.getDate()}
              </Text>
              <Text
                className={`text-[9px] ${
                  isActive
                    ? 'text-rink-passion/80 dark:text-rink-accent/80'
                    : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                {monthAbbr(date, locale)}
              </Text>
              {hasMatches ? (
                <View
                  className={`mt-0.5 h-1 w-1 rounded-full ${
                    isActive
                      ? 'bg-rink-passion dark:bg-rink-accent'
                      : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                />
              ) : (
                <View className="mt-0.5 h-1 w-1 bg-transparent" />
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}
