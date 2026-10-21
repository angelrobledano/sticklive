import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  Pressable,
  Text,
  View,
  useColorScheme,
} from 'react-native';
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
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [containerWidth, setContainerWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const isInitialized = useRef(false);

  const activeIndex = Math.max(0, tabs.indexOf(activeTab));
  const innerWidth = Math.max(0, containerWidth - 8);
  const tabWidth = tabs.length > 0 ? innerWidth / tabs.length : 0;

  useEffect(() => {
    if (tabWidth <= 0) return;
    const targetX = activeIndex * tabWidth;

    if (!isInitialized.current) {
      translateX.setValue(targetX);
      isInitialized.current = true;
    } else {
      Animated.spring(translateX, {
        toValue: targetX,
        damping: 24,
        mass: 0.8,
        stiffness: 240,
        useNativeDriver: true,
      }).start();
    }
  }, [activeIndex, tabWidth, translateX]);

  if (tabs.length <= 1) return null;

  const handleLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    if (width > 0 && width !== containerWidth) {
      setContainerWidth(width);
    }
  };

  return (
    <View
      onLayout={handleLayout}
      className="mx-3 my-3 flex-row items-center rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800 relative"
    >
      {/* Píldora deslizante animada: única superficie activa con elevación */}
      {tabWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 4,
            top: 4,
            bottom: 4,
            width: tabWidth,
            transform: [{ translateX }],
            borderRadius: 8,
            backgroundColor: isDark ? '#0f172a' : '#ffffff',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.1,
            shadowRadius: 2,
            elevation: 2,
          }}
        />
      )}

      {tabs.map((tab) => {
        const isActive = tab === activeTab;
        return (
          <Pressable
            key={tab}
            onPress={() => onChange(tab)}
            accessibilityLabel={t(TAB_I18N[tab])}
            className="flex-1 items-center justify-center py-2 active:opacity-75"
            style={{ zIndex: 1 }}
          >
            <Text
              style={{ color: isActive ? (isDark ? '#fb7185' : BRAND.granate) : undefined }}
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
