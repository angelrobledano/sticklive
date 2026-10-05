import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useSearch } from '@/src/hooks/queries';
import { SEARCH_DEBOUNCE_MS, useDebounced } from '@/src/hooks/useDebounced';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { Avatar, playerPhotoUri, teamLogoUri } from '@/src/components/shared/Avatar';

/**
 * Tab de búsqueda (Task 2.5): TextInput con debounce de 300 ms → useSearch.
 * Tres secciones: equipos → /team/:id, jugadores → /player/:id (el API no trae
 * `name`, sólo firstName/lastName) y competiciones → tab de clasificación.
 */

// Mismo mínimo que el API (searchEnabled en queries.ts): >= 2 caracteres.
const MIN_SEARCH_CHARS = 2;

export default function SearchScreen() {
  const router = useRouter();
  const { t } = useLocale();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, SEARCH_DEBOUNCE_MS);
  const search = useSearch(debounced);

  const clean = debounced.trim();
  const tooShort = clean.length < MIN_SEARCH_CHARS;
  const results = search.data;

  const sectionTitle = 'px-4 pb-1 pt-4 text-xs font-bold uppercase text-slate-500';

  return (
    <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
      <View className="flex-row items-center gap-2 px-3 py-2">
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t('search.placeholder')}
          placeholderTextColor="#94a3b8"
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          className="min-h-[44px] flex-1 rounded-xl bg-white px-3 text-base text-slate-900 dark:bg-slate-900 dark:text-slate-100"
        />
        {q.length > 0 ? (
          <Pressable
            accessibilityLabel={t('search.clear')}
            onPress={() => setQ('')}
            className="min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-white active:opacity-70 dark:bg-slate-900"
          >
            <Text className="text-lg text-slate-500">✕</Text>
          </Pressable>
        ) : null}
      </View>

      {tooShort ? (
        <EmptyState title={t('search.hint').replace('{n}', String(MIN_SEARCH_CHARS))} />
      ) : search.isPending && !results ? (
        <View className="flex-1" />
      ) : search.isError && !results ? (
        <ErrorState onRetry={() => void search.refetch()} />
      ) : !results || results.total === 0 ? (
        <EmptyState title={t('common.no_search_results')} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
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
                      {team.name}
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
                  <Avatar uri={playerPhotoUri(player.id)} name={`${player.firstName} ${player.lastName}`} size={28} />
                  <View className="ml-3 flex-1">
                    <Text numberOfLines={1} className="text-base font-medium">
                      {player.firstName} {player.lastName}
                    </Text>
                    {player.teamName ? <Text className="text-xs text-slate-500">{player.teamName}</Text> : null}
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
                  // Un tab no se apila: push a la ruta del grupo (tabs) abre el tab.
                  onPress={() => router.push('/standings')}
                  className="border-b border-slate-100 bg-white px-4 py-2.5 active:opacity-70 dark:border-slate-800 dark:bg-slate-900"
                >
                  <Text numberOfLines={1} className="text-base font-medium">
                    {competition.name}
                  </Text>
                  {competition.seasonName ? (
                    <Text className="text-xs text-slate-500">{competition.seasonName}</Text>
                  ) : null}
                </Pressable>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
