import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/src/components/shared/Avatar';
import { CountryFlag } from '@/src/components/shared/CountryFlag';
import { clubName } from '@sports/core/names';
import { useLocale } from '@/src/i18n/LocaleContext';

interface MatchGroupCardProps {
  title: string;
  competitionId?: string | null;
  logoUrl?: string | null;
  country?: string | null;
  count: number;
  liveCount?: number;
  followed?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onToggleOpen?: () => void;
  /** Icono propio (p. ej. estrella en Mi grada); manda sobre logo y bandera. */
  icon?: ReactNode;
  children: ReactNode;
}

export function MatchGroupCard({
  title,
  competitionId,
  logoUrl,
  country,
  count,
  liveCount = 0,
  followed = false,
  collapsible = true,
  defaultOpen = true,
  isOpen: controlledOpen,
  onToggleOpen,
  icon,
  children,
}: MatchGroupCardProps) {
  const router = useRouter();
  const { t, tv } = useLocale();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const toggle = () => {
    if (onToggleOpen) {
      onToggleOpen();
    } else {
      setInternalOpen((v) => !v);
    }
  };

  const displayTitle = clubName(title) || title;
  const countText = `${count} ${count === 1 ? t('common.match_lc') : t('common.matches_lc')}`;

  const handleHeaderPress = () => {
    if (competitionId) {
      router.push(`/competition/${competitionId}`);
    } else if (collapsible) {
      toggle();
    }
  };

  return (
    <View className="mx-3 my-1.5 overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {/* Cabecera del grupo / competición */}
      <View className="flex-row items-center border-b border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
        <Pressable
          onPress={handleHeaderPress}
          accessibilityRole={competitionId ? 'button' : 'header'}
          accessibilityLabel={`${displayTitle}, ${countText}${liveCount > 0 ? `, ${tv('home.live_in_block', { n: liveCount })}` : ''}`}
          
          className="flex-1 flex-row items-center gap-2 active:opacity-70"
        >
          {/* Icono: Logo competición -> Bandera de país -> Globo internacional -> Iniciales */}
          {icon ? (
            icon
          ) : logoUrl ? (
            <Avatar uri={logoUrl} name={displayTitle} size={20} variant="competition" />
          ) : country === 'W' ? (
            <View className="h-5 w-5 items-center justify-center rounded-full bg-sky-50 dark:bg-sky-950/50">
              <Ionicons name="globe-outline" size={13} color="#0284c7" />
            </View>
          ) : country && country.length === 2 ? (
            <CountryFlag code={country} size={18} />
          ) : (
            <Avatar name={displayTitle} size={20} variant="competition" />
          )}

          <Text
            numberOfLines={1}
            className="flex-1 text-xs font-bold text-slate-800 dark:text-slate-100"
          >
            {displayTitle}
          </Text>
          {followed ? (
            <Ionicons name="star" size={13} color="#991b1b" accessibilityLabel={t('favorites.following')} />
          ) : null}
          {competitionId ? <Ionicons name="chevron-forward" size={13} color="#94a3b8" /> : null}
        </Pressable>

        <View className="flex-row items-center gap-1.5 pl-2">
          {/* Directos del bloque: plegado se dice «N en directo», como la web */}
          {liveCount > 0 ? (
            <View className="flex-row items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 dark:bg-emerald-950/50">
              <View className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <Text className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                {open ? liveCount : tv('home.live_in_block', { n: liveCount })}
              </Text>
            </View>
          ) : null}

          {/* Recuento total de partidos */}
          <Text className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">{countText}</Text>

          {collapsible ? (
            <Pressable
              onPress={toggle}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={tv(open ? 'home.collapse' : 'home.expand', { name: displayTitle })}
              accessibilityState={{ expanded: open }}
              className="p-1 active:opacity-60"
            >
              <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color="#64748b" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Contenido / Filas de partidos con separadores */}
      {open ? <View className="divide-y divide-slate-100 dark:divide-slate-800/80">{children}</View> : null}
    </View>
  );
}
