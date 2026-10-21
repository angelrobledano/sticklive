import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from 'nativewind';
import { useLocale } from '@/src/i18n/LocaleContext';
import { MIN_SEARCH_LENGTH, searchEnabled, useSearch } from '@/src/hooks/queries';
import { SEARCH_DEBOUNCE_MS, useDebounced } from '@/src/hooks/useDebounced';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { SearchSkeleton } from '@/src/components/shared/Skeleton';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { Avatar, playerPhotoUri, teamLogoUri } from '@/src/components/shared/Avatar';
import { AdBanner } from '@/src/components/ads/AdBanner';
import { clubName, playerDisplayName } from '@/src/lib/names';

/**
 * Tab de búsqueda (Task 2.5): TextInput con debounce de 300 ms → useSearch.
 * Tres secciones: equipos → /team/:id, jugadores → /player/:id (el API no trae
 * `name`, sólo firstName/lastName) y competiciones → tab de clasificación.
 * Cabecera integrada en la zona segura superior sin barra redundante.
 */

export default function SearchScreen() {
  const router = useRouter();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, SEARCH_DEBOUNCE_MS);
  const search = useSearch(debounced);

  const clean = debounced.trim();
  const tooShort = !searchEnabled(clean);
  const results = search.data;

  const sectionTitle = 'px-4 pb-1 pt-4 text-xs font-bold uppercase text-slate-500';

  return (
    <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
      {/* Cabecera integrada de búsqueda para aprovechar al máximo el espacio vertical */}
      <View
        style={{ paddingTop: Math.max(insets.top, 12) }}
        className="border-b border-slate-200 bg-white px-3 pb-2.5 dark:border-slate-800 dark:bg-slate-900"
      >
        <View className="flex-row items-center rounded-xl bg-slate-100 px-3 py-1 dark:bg-slate-800">
          <Ionicons
            name="search-outline"
            size={20}
            color={colorScheme === 'dark' ? '#94a3b8' : '#64748b'}
          />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t('search.placeholder')}
            placeholderTextColor="#94a3b8"
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            className="min-h-[42px] flex-1 px-2.5 text-base text-slate-900 dark:text-slate-100"
          />
          {q.length > 0 ? (
            <Pressable
              accessibilityLabel={t('search.clear')}
              onPress={() => setQ('')}
              hitSlop={8}
              className="h-7 w-7 items-center justify-center rounded-full bg-slate-200 active:opacity-70 dark:bg-slate-700"
            >
              <Ionicons
                name="close"
                size={16}
                color={colorScheme === 'dark' ? '#cbd5e1' : '#475569'}
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      {tooShort ? (
        <EmptyState title={t('search.hint').replace('{n}', String(MIN_SEARCH_LENGTH))} />
      ) : search.isPending && !results ? (
        <SearchSkeleton />
      ) : search.isError && !results ? (
        <ErrorState onRetry={() => void search.refetch()} />
      ) : !results || results.total === 0 ? (
        <EmptyState title={t('common.no_search_results')} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {results.teams.length > 0 ? (
            <>
              <Text className={sectionTitle}>{t('search.section_teams')}</Text>
              {results.teams.map((team) => (
                <Pressable
                  key={team.id}
                  onPress={() => router.push(`/team/${team.id}`)}
                  className="flex-row items-center border-b border-slate-100 bg-white px-4 py-2.5 active:opacity-70 dark:border-slate-800 dark:bg-slate-900"
                >
                  <Avatar uri={teamLogoUri(team.id)} name={team.name} size={28} />
                  <View className="ml-3 flex-1">
                    <Text numberOfLines={1} className="text-base font-medium">
                      {clubName(team.name) || team.name}
                    </Text>
                    {team.country ? <Text className="text-xs text-slate-500">{team.country}</Text> : null}
                  </View>
                </Pressable>
              ))}
            </>
          ) : null}

          {results.players.length > 0 ? (
            <>
              <Text className={sectionTitle}>{t('search.section_players')}</Text>
              {results.players.map((player) => (
                <Pressable
                  key={player.id}
                  onPress={() => router.push(`/player/${player.id}`)}
                  className="flex-row items-center border-b border-slate-100 bg-white px-4 py-2.5 active:opacity-70 dark:border-slate-800 dark:bg-slate-900"
                >
                  <Avatar
                    uri={playerPhotoUri(player.id, 64)}
                    name={`${player.firstName} ${player.lastName}`}
                    size={28}
                    variant="player"
                  />
                  <View className="ml-3 flex-1">
                    <Text numberOfLines={1} className="text-base font-medium">
                      {playerDisplayName(player.firstName, player.lastName)}
                    </Text>
                    {player.teamName ? (
                      <Text className="text-xs text-slate-500">
                        {clubName(player.teamName) || player.teamName}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </>
          ) : null}

          {results.competitions.length > 0 ? (
            <>
              <Text className={sectionTitle}>{t('search.section_competitions')}</Text>
              {results.competitions.map((competition) => (
                <Pressable
                  key={competition.id}
                  onPress={() => router.push(`/competition/${competition.id}`)}
                  className="flex-row items-center border-b border-slate-100 bg-white px-4 py-2.5 active:opacity-70 dark:border-slate-800 dark:bg-slate-900"
                >
                  <Avatar
                    uri={null}
                    name={competition.name}
                    size={28}
                    variant="competition"
                  />
                  <View className="ml-3 flex-1">
                    <Text numberOfLines={1} className="text-base font-medium">
                      {clubName(competition.name) || competition.name}
                    </Text>
                    {competition.seasonName ? (
                      <Text className="text-xs text-slate-500">{competition.seasonName}</Text>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </>
          ) : null}

          {/* Pie del contenido: banner (el gating premium/consentimiento vive en AdBanner). */}
          <AdBanner variant="list" />
        </ScrollView>
      )}
    </View>
  );
}
