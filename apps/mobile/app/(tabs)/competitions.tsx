import { useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BRAND } from '@sports/brand';
import { useLocale } from '@/src/i18n/LocaleContext';
import { useCompetitions } from '@/src/hooks/queries';
import { useFavorites, useLocalFavorites } from '@/src/hooks/favorites';
import { useSession } from '@/src/context/AuthContext';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { CompetitionsSkeleton } from '@/src/components/shared/Skeleton';
import { CountryFlag } from '@/src/components/shared/CountryFlag';
import { FollowButton } from '@/src/components/favorite/FollowButton';
import { AdBanner } from '@/src/components/ads/AdBanner';
import { clubName, competitionName } from '@/src/lib/names';
import {
  currentSeasonYear,
  hasSeasonYear,
  orderByImportance,
} from '@/src/lib/competition-importance';
import {
  countryDisplayName,
  filterCompetitions,
  genderLabel,
  groupCompetitionsForIndex,
  normalizeSearchText,
  orderSearchResults,
} from '@/src/lib/competition-filter';
import type { CompetitionSummary } from '@/src/lib/api/types';

type Tab = 'mis-ligas' | 'principales' | 'todas';

function CompetitionRowItem({
  comp,
  locale,
  t,
}: {
  comp: CompetitionSummary;
  locale: string;
  t: (k: string) => string;
}) {
  const router = useRouter();

  const hasLogo = Boolean(comp.logoUrl);
  const hasFlag = Boolean(comp.country && comp.country.length === 2);
  const isWorld = comp.country === 'W' || comp.scope === 'international';
  const initials = (comp.shortName ?? comp.name).slice(0, 2).toUpperCase();

  // Línea de metadatos (equipos · género · temporada)
  const parts: string[] = [];
  if (comp.season?.teamCount) {
    parts.push(`${comp.season.teamCount} ${t('common.teams_lc')}`);
  }
  const gl = genderLabel(comp.gender, t);
  if (gl) parts.push(gl);
  if (comp.season?.name) parts.push(comp.season.name);
  const meta = parts.join(' · ');

  const displayName = clubName(competitionName(comp.name, comp.nameI18n, locale));

  return (
    <View className="flex-row items-center border-b border-slate-100 last:border-b-0 dark:border-slate-800/60">
      <Pressable
        onPress={() => router.push({ pathname: '/competition/[id]', params: { id: comp.id } })}
        className="flex-1 flex-row items-center gap-3 py-2.5 pl-3 pr-1 active:bg-slate-50 dark:active:bg-slate-800/40"
      >
        {/* Avatar circular */}
        <View
          className={`h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full ${
            hasLogo
              ? 'border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800'
              : hasFlag
                ? 'bg-slate-100 dark:bg-slate-800'
                : 'border border-rose-200 bg-rose-50 dark:border-rose-900/40 dark:bg-rose-950/40'
          }`}
        >
          {hasLogo ? (
            <Image
              source={{ uri: comp.logoUrl! }}
              className="h-full w-full"
              resizeMode="contain"
            />
          ) : hasFlag ? (
            <CountryFlag code={comp.country} size={28} />
          ) : isWorld ? (
            <Text className="text-base leading-none">🌍</Text>
          ) : (
            <Text className="text-[11px] font-black text-rose-800 dark:text-rose-300">
              {initials}
            </Text>
          )}
        </View>

        {/* Textos */}
        <View className="flex-1 min-w-0 pr-1">
          <Text
            numberOfLines={1}
            className="text-[13px] font-bold text-slate-800 dark:text-slate-100"
          >
            {displayName}
          </Text>
          {meta ? (
            <Text
              numberOfLines={1}
              className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400"
            >
              {meta}
            </Text>
          ) : null}
        </View>

        {/* Flecha indicador */}
        <Ionicons name="chevron-forward" size={15} color="#94a3b8" />
      </Pressable>

      {/* Botón de seguir / favoritos */}
      <View className="pr-1.5 shrink-0">
        <FollowButton kind="league" refId={comp.id} name={comp.name} />
      </View>
    </View>
  );
}

function CountryAccordion({
  countryCode,
  label,
  comps,
  isOpen,
  onToggle,
  locale,
  t,
}: {
  countryCode: string | null;
  label: string;
  comps: CompetitionSummary[];
  isOpen: boolean;
  onToggle: () => void;
  locale: string;
  t: (k: string) => string;
}) {
  return (
    <View className="mb-2.5 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {/* Cabecera del país */}
      <Pressable
        onPress={onToggle}
        className="flex-row items-center justify-between px-3.5 py-3 active:bg-slate-50 dark:active:bg-slate-800/40"
      >
        <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
          <CountryFlag code={countryCode} size={22} />
          <Text
            numberOfLines={1}
            className="text-[13px] font-bold text-slate-700 dark:text-slate-200"
          >
            {label}
          </Text>
        </View>

        <View className="flex-row items-center gap-2 shrink-0">
          <View className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
            <Text className="font-mono text-[11px] font-bold text-slate-600 dark:text-slate-300">
              {comps.length}
            </Text>
          </View>
          <Ionicons
            name={isOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color="#64748b"
          />
        </View>
      </Pressable>

      {/* Lista de competiciones */}
      {isOpen && (
        <View className="border-t border-slate-100 dark:border-slate-800/60">
          {comps.map((comp) => (
            <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
          ))}
        </View>
      )}
    </View>
  );
}

export default function CompetitionsScreen() {
  const { t, locale } = useLocale();
  const competitionsQuery = useCompetitions();

  const [activeTab, setActiveTab] = useState<Tab>('todas');
  const [query, setQuery] = useState('');

  // Favoritos
  const { session } = useSession();
  const token = session?.token;
  const serverFavs = useFavorites(token);
  const localFavs = useLocalFavorites(!token);
  const favoriteIds = useMemo(
    () => new Set((token ? serverFavs.data?.leagues : localFavs.data?.leagues) ?? []),
    [token, serverFavs.data, localFavs.data],
  );

  const allComps = useMemo(() => competitionsQuery.data ?? [], [competitionsQuery.data]);

  // Temporada vigente (año mayor deducido automáticamente, p. ej. 2026 en 2026/27)
  const seasonYear = useMemo(() => currentSeasonYear(allComps), [allComps]);
  const relevant = useMemo(
    () => allComps.filter((c) => seasonYear != null && hasSeasonYear(c, seasonYear)),
    [allComps, seasonYear],
  );

  // Búsqueda instantánea
  const q = normalizeSearchText(query.trim());
  const isSearching = q.length > 0;

  const searchResults = useMemo(() => {
    if (!q) return [];
    const matches = filterCompetitions(allComps, query, (code) => countryDisplayName(code, locale));
    return orderSearchResults(matches, q, locale);
  }, [allComps, q, query, locale]);

  // Datos por pestaña
  const principales = useMemo(
    () => orderByImportance(relevant.filter((c) => c.scope === 'national'), locale),
    [relevant, locale],
  );

  const misLigas = useMemo(
    () => orderByImportance(allComps.filter((c) => favoriteIds.has(c.id)), locale),
    [allComps, favoriteIds, locale],
  );

  const { international, byCountry } = useMemo(
    () => groupCompetitionsForIndex(relevant, locale),
    [relevant, locale],
  );

  // Estado de acordeones de países (abiertos por defecto si tienen favoritos o España)
  const [openCountries, setOpenCountries] = useState<Record<string, boolean>>({ ES: true });

  const toggleCountry = (code: string) => {
    setOpenCountries((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  if (competitionsQuery.isPending) {
    return <CompetitionsSkeleton />;
  }

  if (competitionsQuery.isError) {
    return (
      <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
        <ErrorState onRetry={() => void competitionsQuery.refetch()} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-rink-floor dark:bg-rink-floor-dark">
      {/* ── Buscador y pestañas fijas ────────────────────────────────────────── */}
      <View className="border-b border-slate-200/80 bg-white px-3 pb-3 pt-2.5 dark:border-slate-800 dark:bg-slate-900">
        {/* Input de búsqueda */}
        <View className="flex-row items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-950">
          <Ionicons name="search-outline" size={18} color="#94a3b8" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('competitions.search_placeholder')}
            placeholderTextColor="#94a3b8"
            className="ml-2 flex-1 text-sm font-medium text-slate-900 dark:text-slate-100 py-1"
            returnKeyType="search"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} className="p-0.5 active:opacity-60">
              <Ionicons name="close-circle" size={18} color="#94a3b8" />
            </Pressable>
          )}
        </View>

        {/* Segmented filter pills (solo si no se está buscando) */}
        {!isSearching && (
          <View className="mt-2.5 flex-row gap-2">
            {/* Mis Ligas */}
            <Pressable
              onPress={() => setActiveTab('mis-ligas')}
              className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl py-2 px-1 border ${
                activeTab === 'mis-ligas'
                  ? 'border-rose-900 bg-rose-900 dark:border-rose-700 dark:bg-rose-800'
                  : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60'
              }`}
            >
              <Ionicons
                name="star"
                size={13}
                color={activeTab === 'mis-ligas' ? '#ffffff' : BRAND.granate}
              />
              <Text
                numberOfLines={1}
                className={`text-xs font-bold ${
                  activeTab === 'mis-ligas'
                    ? 'text-white'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {t('competitions.tab_my_leagues')}
              </Text>
              {favoriteIds.size > 0 && (
                <View
                  className={`rounded-full px-1.5 py-0.2 ${
                    activeTab === 'mis-ligas'
                      ? 'bg-rose-800 dark:bg-rose-900'
                      : 'bg-slate-200 dark:bg-slate-800'
                  }`}
                >
                  <Text
                    className={`font-mono text-[10px] font-black ${
                      activeTab === 'mis-ligas'
                        ? 'text-white'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {favoriteIds.size}
                  </Text>
                </View>
              )}
            </Pressable>

            {/* Principales */}
            <Pressable
              onPress={() => setActiveTab('principales')}
              className={`flex-1 items-center justify-center rounded-xl py-2 px-1 border ${
                activeTab === 'principales'
                  ? 'border-rose-900 bg-rose-900 dark:border-rose-700 dark:bg-rose-800'
                  : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60'
              }`}
            >
              <Text
                numberOfLines={1}
                className={`text-xs font-bold ${
                  activeTab === 'principales'
                    ? 'text-white'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {t('competitions.tab_main')}
              </Text>
            </Pressable>

            {/* Todas */}
            <Pressable
              onPress={() => setActiveTab('todas')}
              className={`flex-1 items-center justify-center rounded-xl py-2 px-1 border ${
                activeTab === 'todas'
                  ? 'border-rose-900 bg-rose-900 dark:border-rose-700 dark:bg-rose-800'
                  : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60'
              }`}
            >
              <Text
                numberOfLines={1}
                className={`text-xs font-bold ${
                  activeTab === 'todas'
                    ? 'text-white'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {t('competitions.tab_all')}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* ── Lista de contenido ──────────────────────────────────────────────── */}
      <ScrollView
        className="flex-1 px-3 pt-3"
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={competitionsQuery.isRefetching}
            onRefresh={() => void competitionsQuery.refetch()}
          />
        }
      >
        {isSearching ? (
          // Resultados de búsqueda
          searchResults.length === 0 ? (
            <View className="py-12 items-center justify-center">
              <EmptyState
                title={t('common.no_search_results')}
                hint={`«${query}»`}
              />
              <Pressable
                onPress={() => setQuery('')}
                className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <Text className="text-xs font-semibold text-rose-800 dark:text-rose-300">
                  Limpiar búsqueda
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              {searchResults.map((comp) => (
                <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
              ))}
            </View>
          )
        ) : activeTab === 'mis-ligas' ? (
          // Pestaña Mis Ligas
          misLigas.length === 0 ? (
            <View className="py-12 items-center justify-center px-4">
              <EmptyState
                title={t('competitions.no_fav_leagues_title')}
                hint={t('competitions.no_fav_leagues_hint')}
              />
              <Pressable
                onPress={() => setActiveTab('todas')}
                className="mt-4 rounded-xl bg-rose-900 px-5 py-2.5 shadow-sm active:bg-rose-950 dark:bg-rose-800"
              >
                <Text className="text-xs font-bold text-white">
                  Explorar todas las competiciones
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              {misLigas.map((comp) => (
                <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
              ))}
            </View>
          )
        ) : activeTab === 'principales' ? (
          // Pestaña Principales
          <View className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {principales.map((comp) => (
              <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
            ))}
          </View>
        ) : (
          // Pestaña Todas (Internacional + acordeones por país)
          <View>
            {/* Competiciones Internacionales */}
            {international.length > 0 && (
              <View className="mb-2.5 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <View className="flex-row items-center gap-2 border-b border-slate-100 px-3.5 py-3 dark:border-slate-800/60">
                  <Text className="text-base leading-none">🌍</Text>
                  <Text className="text-[13px] font-bold text-slate-700 dark:text-slate-200">
                    {t('competitions.international')}
                  </Text>
                  <View className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                    <Text className="font-mono text-[11px] font-bold text-slate-600 dark:text-slate-300">
                      {international.length}
                    </Text>
                  </View>
                </View>
                {international.map((comp) => (
                  <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
                ))}
              </View>
            )}

            {/* Acordeones por país */}
            {byCountry.map(([code, countryComps]) => (
              <CountryAccordion
                key={code}
                countryCode={code}
                label={countryDisplayName(code, locale) || code}
                comps={countryComps}
                isOpen={Boolean(openCountries[code])}
                onToggle={() => toggleCountry(code)}
                locale={locale}
                t={t}
              />
            ))}
          </View>
        )}

        {/* Banner publicitario */}
        <View className="mt-4">
          <AdBanner variant="list" />
        </View>
      </ScrollView>
    </View>
  );
}
