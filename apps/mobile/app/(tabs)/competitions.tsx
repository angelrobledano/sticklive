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
import { useCompetitions, useFederations } from '@/src/hooks/queries';
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
  normalizeSearchText,
  orderSearchResults,
} from '@/src/lib/competition-filter';
import {
  buildCompetitionTree,
  featuredCompetitions,
  filterByGender,
  isCup,
  type CountryGroup,
  type FederationGroup,
  type GenderFilter,
} from '@/src/lib/competition-groups';
import type { CompetitionSummary } from '@/src/lib/api/types';

type Tab = 'destacadas' | 'paises' | 'mis-ligas';

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

  // Línea de metadatos (equipos · género · categoría · temporada)
  const parts: string[] = [];
  if (comp.season?.teamCount) {
    parts.push(`${comp.season.teamCount} ${t('common.teams_lc') || 'equipos'}`);
  }
  const gl = genderLabel(comp.gender, t);
  if (gl) parts.push(gl);

  if (comp.tier === 1) {
    parts.push('1ª Cat.');
  } else if (isCup(comp)) {
    parts.push(t('competitions.section_cups') || 'Copa');
  }

  const meta = parts.join(' · ');
  const displayName = clubName(competitionName(comp.name, comp.nameI18n, locale));

  return (
    <View className="flex-row items-center border-b border-slate-100 last:border-b-0 dark:border-slate-800/60">
      <Pressable
        onPress={() => router.push({ pathname: '/competition/[id]', params: { id: comp.id } })}
        className="flex-1 flex-row items-center gap-3 py-2.5 pl-3 pr-1 active:bg-slate-50 dark:active:bg-slate-800/40 min-h-[50px]"
      >
        {/* Avatar circular */}
        <View
          className={`h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full ${
            hasLogo
              ? 'border border-slate-200 bg-white p-0.5 dark:border-slate-700'
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

function RegionalFederationAccordion({
  group,
  isOpen,
  onToggle,
  locale,
  t,
}: {
  group: FederationGroup;
  isOpen: boolean;
  onToggle: () => void;
  locale: string;
  t: (k: string) => string;
}) {
  return (
    <View className="border-b border-slate-100 last:border-b-0 dark:border-slate-800/60">
      <Pressable
        onPress={onToggle}
        className="flex-row items-center justify-between px-3.5 py-2.5 bg-slate-50/70 dark:bg-slate-800/40 active:bg-slate-100 dark:active:bg-slate-800"
      >
        <View className="flex-row items-center gap-2 flex-1 min-w-0 pr-2">
          <Ionicons
            name={isOpen ? 'chevron-down' : 'chevron-forward'}
            size={14}
            color="#64748b"
          />
          <Text numberOfLines={1} className="text-xs font-bold text-slate-700 dark:text-slate-300">
            {group.label}
          </Text>
        </View>
        <View className="rounded-full bg-slate-200/80 px-2 py-0.5 dark:bg-slate-700">
          <Text className="font-mono text-[10px] font-bold text-slate-600 dark:text-slate-300">
            {group.comps.length}
          </Text>
        </View>
      </Pressable>

      {isOpen && (
        <View className="pl-2 border-t border-slate-100 dark:border-slate-800/60 bg-white dark:bg-slate-900">
          {group.comps.map((comp) => (
            <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
          ))}
        </View>
      )}
    </View>
  );
}

function CountryAccordion({
  country,
  isOpen,
  onToggle,
  openFederations,
  onToggleFederation,
  locale,
  t,
}: {
  country: CountryGroup;
  isOpen: boolean;
  onToggle: () => void;
  openFederations: Record<string, boolean>;
  onToggleFederation: (key: string) => void;
  locale: string;
  t: (k: string) => string;
}) {
  const { code, total, sections } = country;
  const label = countryDisplayName(code, locale) || code;
  const { leagues, cups, base, regional } = sections;

  return (
    <View className="mb-2.5 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {/* Cabecera del país */}
      <Pressable
        onPress={onToggle}
        className="flex-row items-center justify-between px-3.5 py-3 active:bg-slate-50 dark:active:bg-slate-800/40"
      >
        <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
          <CountryFlag code={code} size={22} />
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
              {total}
            </Text>
          </View>
          <Ionicons
            name={isOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color="#64748b"
          />
        </View>
      </Pressable>

      {/* Secciones internas si está abierto */}
      {isOpen && (
        <View className="border-t border-slate-100 dark:border-slate-800/60">
          {/* Ligas nacionales */}
          {leagues.length > 0 && (
            <View>
              <View className="bg-slate-50/70 px-3.5 py-1.5 border-b border-slate-100 dark:bg-slate-800/30 dark:border-slate-800/60">
                <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {t('competitions.section_leagues') || 'Ligas'}
                </Text>
              </View>
              {leagues.map((comp) => (
                <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
              ))}
            </View>
          )}

          {/* Copas nacionales */}
          {cups.length > 0 && (
            <View>
              <View className="bg-slate-50/70 px-3.5 py-1.5 border-b border-slate-100 dark:bg-slate-800/30 dark:border-slate-800/60">
                <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {t('competitions.section_cups') || 'Copas'}
                </Text>
              </View>
              {cups.map((comp) => (
                <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
              ))}
            </View>
          )}

          {/* Base */}
          {base.length > 0 && (
            <View>
              <View className="bg-slate-50/70 px-3.5 py-1.5 border-b border-slate-100 dark:bg-slate-800/30 dark:border-slate-800/60">
                <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {t('competitions.section_base') || 'Categorías de base'}
                </Text>
              </View>
              {base.map((comp) => (
                <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
              ))}
            </View>
          )}

          {/* Autonómicas / Regionales */}
          {regional.length > 0 && (
            <View>
              <View className="bg-slate-50/70 px-3.5 py-1.5 border-b border-slate-100 dark:bg-slate-800/30 dark:border-slate-800/60">
                <Text className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {t('competitions.section_regional') || 'Federaciones autonómicas'}
                </Text>
              </View>
              {regional.map((group) => (
                <RegionalFederationAccordion
                  key={group.key}
                  group={group}
                  isOpen={Boolean(openFederations[group.key])}
                  onToggle={() => onToggleFederation(group.key)}
                  locale={locale}
                  t={t}
                />
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export default function CompetitionsScreen() {
  const { t, locale } = useLocale();
  const competitionsQuery = useCompetitions();
  const federationsQuery = useFederations();

  const [activeTab, setActiveTab] = useState<Tab>('destacadas');
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all');
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
  const federations = useMemo(() => federationsQuery.data ?? [], [federationsQuery.data]);

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

  // Filtro de género sobre las competiciones relevantes
  const relevantByGender = useMemo(
    () => filterByGender(relevant, genderFilter),
    [relevant, genderFilter],
  );

  // Pestaña Destacadas (curación featuredRank y tier 1 sénior)
  const destacadas = useMemo(
    () => featuredCompetitions(relevantByGender, locale),
    [relevantByGender, locale],
  );

  // Pestaña Mis Ligas (con filtro de género opcional)
  const misLigas = useMemo(() => {
    const followed = allComps.filter((c) => favoriteIds.has(c.id));
    return orderByImportance(filterByGender(followed, genderFilter), locale);
  }, [allComps, favoriteIds, genderFilter, locale]);

  // Pestaña Países (árbol internacional + países + federaciones autonómicas)
  const tree = useMemo(
    () => buildCompetitionTree(relevantByGender, locale, federations, (code) => countryDisplayName(code, locale)),
    [relevantByGender, locale, federations],
  );

  // Estado de acordeones de países (España abierta por defecto)
  const [openCountries, setOpenCountries] = useState<Record<string, boolean>>({ ES: true });
  const toggleCountry = (code: string) => {
    setOpenCountries((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  // Estado de acordeones de federaciones autonómicas
  const [openFederations, setOpenFederations] = useState<Record<string, boolean>>({});
  const toggleFederation = (key: string) => {
    setOpenFederations((prev) => ({ ...prev, [key]: !prev[key] }));
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
      {/* ── Buscador, pestañas principales y selector de género ───────────────── */}
      <View className="border-b border-slate-200/80 bg-white px-3 pb-3 pt-2.5 dark:border-slate-800 dark:bg-slate-900">
        {/* Input de búsqueda */}
        <View className="flex-row items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-950">
          <Ionicons name="search-outline" size={18} color="#94a3b8" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('competitions.search_placeholder') || 'Buscar liga, país o federación...'}
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

        {/* Pestañas principales (Destacadas · Países · Mis Ligas) */}
        {!isSearching && (
          <View className="mt-2.5 flex-row gap-2">
            {/* Destacadas */}
            <Pressable
              onPress={() => setActiveTab('destacadas')}
              className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl py-2 px-1 border ${
                activeTab === 'destacadas'
                  ? 'border-rose-900 bg-rose-900 dark:border-rose-700 dark:bg-rose-800'
                  : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60'
              }`}
            >
              <Ionicons
                name="flame"
                size={14}
                color={activeTab === 'destacadas' ? '#ffffff' : BRAND.granate}
              />
              <Text
                numberOfLines={1}
                className={`text-xs font-bold ${
                  activeTab === 'destacadas'
                    ? 'text-white'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {t('competitions.tab_main') || 'Destacadas'}
              </Text>
            </Pressable>

            {/* Países */}
            <Pressable
              onPress={() => setActiveTab('paises')}
              className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl py-2 px-1 border ${
                activeTab === 'paises'
                  ? 'border-rose-900 bg-rose-900 dark:border-rose-700 dark:bg-rose-800'
                  : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60'
              }`}
            >
              <Ionicons
                name="globe-outline"
                size={13}
                color={activeTab === 'paises' ? '#ffffff' : '#64748b'}
              />
              <Text
                numberOfLines={1}
                className={`text-xs font-bold ${
                  activeTab === 'paises'
                    ? 'text-white'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {t('competitions.tab_all') || 'Países'}
              </Text>
            </Pressable>

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
                {t('competitions.tab_my_leagues') || 'Mis Ligas'}
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
          </View>
        )}

        {/* Selector de Género (Todas / Masc. / Fem.) */}
        {!isSearching && (
          <View className="mt-2.5 flex-row gap-1.5">
            {(['all', 'male', 'female'] as const).map((g) => {
              const isSelected = genderFilter === g;
              const label =
                g === 'all'
                  ? (t('competitions.gender_all') || 'Todas')
                  : g === 'male'
                    ? (t('common.male') || 'Masculino')
                    : (t('common.female') || 'Femenino');

              return (
                <Pressable
                  key={g}
                  onPress={() => setGenderFilter(g)}
                  className={`flex-1 items-center justify-center rounded-lg py-1.5 border ${
                    isSelected
                      ? 'border-slate-800 bg-slate-800 dark:border-slate-100 dark:bg-slate-100'
                      : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60'
                  }`}
                >
                  <Text
                    numberOfLines={1}
                    className={`text-[11px] font-semibold ${
                      isSelected
                        ? 'text-white dark:text-slate-900'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {/* ── Lista de contenido ──────────────────────────────────────────────── */}
      <ScrollView
        className="flex-1 px-3 pt-3"
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={
          <RefreshControl
            refreshing={competitionsQuery.isRefetching || federationsQuery.isRefetching}
            onRefresh={() => {
              void competitionsQuery.refetch();
              void federationsQuery.refetch();
            }}
          />
        }
      >
        {isSearching ? (
          // Resultados de búsqueda
          searchResults.length === 0 ? (
            <View className="py-12 items-center justify-center">
              <EmptyState
                title={t('common.no_search_results') || 'Sin resultados'}
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
        ) : activeTab === 'destacadas' ? (
          // Pestaña Destacadas
          destacadas.length === 0 ? (
            <View className="py-12 items-center justify-center px-4">
              <EmptyState
                title="Sin competiciones destacadas"
                hint="No hay competiciones que coincidan con el filtro de género seleccionado."
              />
            </View>
          ) : (
            <View className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              {destacadas.map((comp) => (
                <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
              ))}
            </View>
          )
        ) : activeTab === 'mis-ligas' ? (
          // Pestaña Mis Ligas
          misLigas.length === 0 ? (
            <View className="py-12 items-center justify-center px-4">
              <EmptyState
                title={t('competitions.no_fav_leagues_title') || 'Todavía no tienes ligas favoritas'}
                hint={t('competitions.no_fav_leagues_hint') || 'Pulsa la estrella en cualquier competición para guardarla aquí.'}
              />
              <Pressable
                onPress={() => setActiveTab('destacadas')}
                className="mt-4 rounded-xl bg-rose-900 px-5 py-2.5 shadow-sm active:bg-rose-950 dark:bg-rose-800"
              >
                <Text className="text-xs font-bold text-white">
                  Explorar competiciones destacadas
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
        ) : (
          // Pestaña Países (Internacional + acordeones por país con Ligas, Copas, Base y Autonómicas)
          <View>
            {/* Competiciones Internacionales */}
            {tree.international.length > 0 && (
              <View className="mb-2.5 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <View className="flex-row items-center gap-2 border-b border-slate-100 px-3.5 py-3 dark:border-slate-800/60">
                  <Text className="text-base leading-none">🌍</Text>
                  <Text className="text-[13px] font-bold text-slate-700 dark:text-slate-200">
                    {t('competitions.international') || 'Mundo'}
                  </Text>
                  <View className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                    <Text className="font-mono text-[11px] font-bold text-slate-600 dark:text-slate-300">
                      {tree.international.length}
                    </Text>
                  </View>
                </View>
                {tree.international.map((comp) => (
                  <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
                ))}
              </View>
            )}

            {/* Acordeones por país */}
            {tree.countries.map((country) => (
              <CountryAccordion
                key={country.code}
                country={country}
                isOpen={Boolean(openCountries[country.code])}
                onToggle={() => toggleCountry(country.code)}
                openFederations={openFederations}
                onToggleFederation={toggleFederation}
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
