import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/src/components/shared/Avatar';
import { CountryFlag } from '@/src/components/shared/CountryFlag';
import { clubName } from '@sports/core/names';

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
  children,
}: MatchGroupCardProps) {
  const router = useRouter();
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
          accessibilityLabel={`${displayTitle}, ${count} ${count === 1 ? 'partido' : 'partidos'}${liveCount > 0 ? `, ${liveCount} en directo` : ''}`}
          accessibilityHint={competitionId ? 'Abre la competición' : undefined}
          className="flex-1 flex-row items-center gap-2 active:opacity-70"
        >
          {/* Icono: Logo competición -> Bandera de país -> Globo internacional -> Iniciales */}
          {logoUrl ? (
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
          {followed ? <Ionicons name="star" size={13} color="#991b1b" /> : null}
          {competitionId ? <Ionicons name="chevron-forward" size={13} color="#94a3b8" /> : null}
        </Pressable>

        <View className="flex-row items-center gap-1.5 pl-2">
          {/* Indicador de directos en el bloque */}
          {liveCount > 0 ? (
            <View className="flex-row items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 dark:bg-emerald-950/50">
              <View className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <Text className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                {liveCount}
              </Text>
            </View>
          ) : null}

          {/* Recuento total de partidos */}
          <View className="rounded-full bg-slate-200/70 px-2 py-0.5 dark:bg-slate-700">
            <Text className="text-[10px] font-bold text-slate-600 dark:text-slate-300">
              {count}
            </Text>
          </View>

          {collapsible ? (
            <Pressable
              onPress={toggle}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={open ? 'Plegar grupo de partidos' : 'Desplegar grupo de partidos'}
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
