import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/src/components/shared/Avatar';
import { clubName } from '@/src/lib/names';

interface MatchGroupCardProps {
  title: string;
  competitionId?: string | null;
  logoUrl?: string | null;
  count: number;
  followed?: boolean;
  collapsible?: boolean;
  children: ReactNode;
}

export function MatchGroupCard({
  title,
  competitionId,
  logoUrl,
  count,
  followed = false,
  collapsible = true,
  children,
}: MatchGroupCardProps) {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  const displayTitle = clubName(title) || title;

  const handleHeaderPress = () => {
    if (competitionId) {
      router.push(`/competition/${competitionId}`);
    } else if (collapsible) {
      setOpen((v) => !v);
    }
  };

  return (
    <View className="mx-3 my-1.5 overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {/* Cabecera del grupo / competición */}
      <View className="flex-row items-center border-b border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
        <Pressable
          onPress={handleHeaderPress}
          className="flex-1 flex-row items-center gap-2 active:opacity-70"
        >
          <Avatar
            uri={logoUrl}
            name={displayTitle}
            size={20}
            variant="competition"
          />
          <Text
            numberOfLines={1}
            className="flex-1 text-xs font-bold text-slate-800 dark:text-slate-100"
          >
            {displayTitle}
          </Text>
          {followed ? (
            <Ionicons name="star" size={13} color="#991b1b" />
          ) : null}
          {competitionId ? (
            <Ionicons name="chevron-forward" size={13} color="#94a3b8" />
          ) : null}
        </Pressable>

        <View className="flex-row items-center gap-2 pl-2">
          <View className="rounded-full bg-slate-200/70 px-2 py-0.5 dark:bg-slate-700">
            <Text className="text-[10px] font-bold text-slate-600 dark:text-slate-300">
              {count}
            </Text>
          </View>

          {collapsible ? (
            <Pressable
              onPress={() => setOpen((v) => !v)}
              hitSlop={8}
              className="p-1 active:opacity-60"
            >
              <Ionicons
                name={open ? 'chevron-up' : 'chevron-down'}
                size={16}
                color="#64748b"
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Contenido / Filas de partidos con separadores */}
      {open ? <View className="divide-y divide-slate-100 dark:divide-slate-800/80">{children}</View> : null}
    </View>
  );
}
