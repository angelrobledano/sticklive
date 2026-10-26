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
import { usePreferredCountry } from '@/src/hooks/usePreferredCountry';
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

/** Tipos de selector principal: destacadas, países (ES, PT, IT...), internacional y favoritas */
type TabKey = 'destacadas' | 'favoritas' | 'international' | string;

// ── Fila de competición compacta y táctil ─────────────────────────────────────
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

  // Línea de metadatos (equipos · género · categoría)
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
  } else if (comp.federation?.shortName) {
    parts.push(comp.federation.shortName);
  }

  const meta = parts.join(' · ');
  const displayName = clubName(competitionName(comp.name, comp.nameI18n, locale));

  return (
    <View className="flex-row items-center border-b border-slate-100 last:border-b-0 dark:border-slate-800/60">
      <Pressable
        onPress={() => router.push({ pathname: '/competition/[id]', params: { id: comp.id } })}
        accessibilityRole="button"
        accessibilityLabel={`${displayName}, ${meta}`}
        accessibilityHint="Abre los partidos y clasificación de la competición"
        className="flex-1 flex-row items-center gap-3 py-2.5 pl-3 pr-1 active:bg-slate-50 dark:active:bg-slate-800/40 min-h-[50px]"
      >
        {/* Avatar circular */}
        <View
          className={`h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full ${
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
            <CountryFlag code={comp.country} size={22} />
          ) : isWorld ? (
            <Text className="text-sm leading-none">🌍</Text>
          ) : (
            <Text className="text-[10px] font-black text-rose-800 dark:text-rose-300">
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

        {/* Indicador de navegación */}
        <Ionicons name="chevron-forward" size={14} color="#94a3b8" />
      </Pressable>

      {/* Botón de seguir / favoritos (48x48dp accesible con hitSlop) */}
      <View className="pr-1 shrink-0">
        <FollowButton kind="league" refId={comp.id} name={comp.name} />
      </View>
    </View>
  );
}

// ── Bloque colapsable de categoría o división ─────────────────────────────────
function CollapsibleSection({
  title,
  iconName,
  count,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  iconName?: keyof typeof Ionicons.glyphMap;
  count?: number;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View className="mb-2.5 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${count != null ? `${count} elementos` : ''}`}
        accessibilityState={{ expanded: isOpen }}
        className="flex-row items-center justify-between px-3.5 py-3 active:bg-slate-50 dark:active:bg-slate-800/40"
      >
        <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
          {iconName ? <Ionicons name={iconName} size={16} color="#64748b" /> : null}
          <Text
            numberOfLines={1}
            className="text-[13px] font-bold text-slate-800 dark:text-slate-200"
          >
            {title}
          </Text>
        </View>

        <View className="flex-row items-center gap-2 shrink-0">
          {count != null ? (
            <View className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
              <Text className="font-mono text-[11px] font-bold text-slate-600 dark:text-slate-300">
                {count}
              </Text>
            </View>
          ) : null}
          <Ionicons
            name={isOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color="#64748b"
          />
        </View>
      </Pressable>

      {isOpen && (
        <View className="border-t border-slate-100 dark:border-slate-800/60">
          {children}
        </View>
      )}
    </View>
  );
}

// ── Sub-acordeón para federación autonómica / regional ────────────────────────
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
        accessibilityRole="button"
        accessibilityLabel={`${group.label}, ${group.comps.length} competiciones`}
        accessibilityState={{ expanded: isOpen }}
        className="flex-row items-center justify-between px-3.5 py-2.5 bg-slate-50/70 dark:bg-slate-800/40 active:bg-slate-100 dark:active:bg-slate-800"
      >
        <View className="flex-row items-center gap-2 flex-1 min-w-0 pr-2">
          <Ionicons
            name={isOpen ? 'chevron-down' : 'chevron-forward'}
            size={13}
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
        <View className="pl-1 border-t border-slate-100 dark:border-slate-800/60 bg-white dark:bg-slate-900">
          {group.comps.map((comp) => (
            <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
          ))}
        </View>
      )}
    </View>
  );
}

// ── Catálogo por país con ligas principales visibles y el resto plegado ──────
function CountryCatalogView({
  country,
  openSections,
  onToggleSection,
  openFederations,
  onToggleFederation,
  locale,
  t,
}: {
  country: CountryGroup;
  openSections: Record<string, boolean>;
  onToggleSection: (key: string) => void;
  openFederations: Record<string, boolean>;
  onToggleFederation: (key: string) => void;
  locale: string;
  t: (k: string) => string;
}) {
  const { code, sections, federation } = country;
  const countryName = countryDisplayName(code, locale) || code;
  const { mainLeagues, otherLeagues, cups, base, regional } = sections;

  return (
    <View>
      {/* Cabecera compacta de la federación / país */}
      <View className="mb-2.5 flex-row items-center justify-between rounded-xl bg-slate-100/80 px-3 py-2 dark:bg-slate-800/60">
        <View className="flex-row items-center gap-2 flex-1 min-w-0">
          <CountryFlag code={code} size={20} />
          <Text numberOfLines={1} className="text-xs font-bold text-slate-700 dark:text-slate-200">
            {federation?.name ?? countryName}
          </Text>
        </View>
        <Text className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 shrink-0">
          {country.total} {country.total === 1 ? 'competición' : 'competiciones'}
        </Text>
      </View>

      {/* 1. Ligas Principales (Tier 1) — Siempre desplegadas de forma prominente */}
      {mainLeagues.length > 0 && (
        <View className="mb-2.5 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <View className="flex-row items-center justify-between border-b border-slate-100 bg-slate-50/80 px-3.5 py-2.5 dark:border-slate-800/60 dark:bg-slate-800/40">
            <View className="flex-row items-center gap-1.5">
              <Ionicons name="trophy" size={14} color={BRAND.granate} />
              <Text className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                {t('competitions.section_main_leagues') || 'Ligas principales'}
              </Text>
            </View>
            <View className="rounded-full bg-rose-100 px-2 py-0.5 dark:bg-rose-950/60">
              <Text className="font-mono text-[10px] font-bold text-rose-900 dark:text-rose-300">
                {mainLeagues.length}
              </Text>
            </View>
          </View>
          {mainLeagues.map((comp) => (
            <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
          ))}
        </View>
      )}

      {/* 2. Copas y Supercopas — Sección contraíble */}
      {cups.length > 0 && (
        <CollapsibleSection
          title={t('competitions.section_cups') || 'Copas y Supercopas'}
          iconName="medal-outline"
          count={cups.length}
          isOpen={Boolean(openSections[`${code}:cups`])}
          onToggle={() => onToggleSection(`${code}:cups`)}
        >
          {cups.map((comp) => (
            <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
          ))}
        </CollapsibleSection>
      )}

      {/* 3. Otras Divisiones (Plata, Bronce...) — Sección contraíble */}
      {otherLeagues.length > 0 && (
        <CollapsibleSection
          title={t('competitions.section_other_leagues') || 'Otras ligas y divisiones'}
          iconName="layers-outline"
          count={otherLeagues.length}
          isOpen={Boolean(openSections[`${code}:otherLeagues`])}
          onToggle={() => onToggleSection(`${code}:otherLeagues`)}
        >
          {otherLeagues.map((comp) => (
            <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
          ))}
        </CollapsibleSection>
      )}

      {/* 4. Categorías de Base — Sección contraíble */}
      {base.length > 0 && (
        <CollapsibleSection
          title={t('competitions.section_base') || 'Categorías de base'}
          iconName="people-outline"
          count={base.length}
          isOpen={Boolean(openSections[`${code}:base`])}
          onToggle={() => onToggleSection(`${code}:base`)}
        >
          {base.map((comp) => (
            <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
          ))}
        </CollapsibleSection>
      )}

      {/* 5. Federaciones Autonómicas — Sección contraíble */}
      {regional.length > 0 && (
        <CollapsibleSection
          title={t('competitions.section_regional') || 'Federaciones autonómicas'}
          iconName="map-outline"
          count={regional.length}
          isOpen={Boolean(openSections[`${code}:regional`])}
          onToggle={() => onToggleSection(`${code}:regional`)}
        >
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
        </CollapsibleSection>
      )}
    </View>
  );
}

// ── Pantalla Principal ────────────────────────────────────────────────────────
export default function CompetitionsScreen() {
  const { t, locale } = useLocale();
  const competitionsQuery = useCompetitions();
  const federationsQuery = useFederations();

  // Preferencia del usuario (ES por defecto si está en España)
  const { country: preferredCountry } = usePreferredCountry();

  // Tab activo: por defecto el país preferido del usuario si existe, o 'destacadas'
  const [activeTab, setActiveTab] = useState<TabKey>(() => preferredCountry ?? 'ES');
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

  // Competiciones seguidas (Mis Ligas)
  const misLigas = useMemo(() => {
    const followed = allComps.filter((c) => favoriteIds.has(c.id));
    return orderByImportance(filterByGender(followed, genderFilter), locale);
  }, [allComps, favoriteIds, genderFilter, locale]);

  // Destacadas globales
  const destacadas = useMemo(
    () => featuredCompetitions(relevantByGender, locale),
    [relevantByGender, locale],
  );

  // Árbol estructurado por país e internacional
  const tree = useMemo(
    () => buildCompetitionTree(relevantByGender, locale, federations, (code) => countryDisplayName(code, locale)),
    [relevantByGender, locale, federations],
  );

  // Control de apertura de secciones internas
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Control de apertura de federaciones regionales
  const [openFederations, setOpenFederations] = useState<Record<string, boolean>>({});
  const toggleFederation = (key: string) => {
    setOpenFederations((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Lista de países disponibles en el árbol
  const availableCountries = tree.countries;

  // Si el tab activo es un país pero no existe en los datos, fallback a destacadas
  const selectedCountryGroup = availableCountries.find((c) => c.code === activeTab);

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
      {/* ── Cabecera compacta y sticky: Búsqueda, selector de país y género ──── */}
      <View className="border-b border-slate-200/80 bg-white px-3 pb-2.5 pt-2 dark:border-slate-800 dark:bg-slate-900 shadow-sm z-10">
        {/* Input de búsqueda accesible */}
        <View className="flex-row items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-950">
          <Ionicons name="search-outline" size={17} color="#94a3b8" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('competitions.search_placeholder') || 'Buscar liga, país o federación...'}
            placeholderTextColor="#94a3b8"
            className="ml-2 flex-1 text-sm font-medium text-slate-900 dark:text-slate-100 py-0.5"
            returnKeyType="search"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable
              onPress={() => setQuery('')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Limpiar búsqueda"
              className="p-1 active:opacity-60"
            >
              <Ionicons name="close-circle" size={17} color="#94a3b8" />
            </Pressable>
          )}
        </View>

        {/* Selector de país y categorías (Pestañas horizontales scrolleables) */}
        {!isSearching && (
          <View className="mt-2.5">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingHorizontal: 1 }}
            >
              {/* Destacadas */}
              <Pressable
                onPress={() => setActiveTab('destacadas')}
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === 'destacadas' }}
                className={`min-h-[38px] flex-row items-center gap-1.5 rounded-full px-3.5 py-1.5 border active:opacity-75 ${
                  activeTab === 'destacadas'
                    ? 'border-rose-900 bg-rose-900 dark:border-rose-700 dark:bg-rose-800 shadow-sm'
                    : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/70'
                }`}
              >
                <Ionicons
                  name="flame"
                  size={14}
                  color={activeTab === 'destacadas' ? '#ffffff' : BRAND.granate}
                />
                <Text
                  className={`text-xs font-bold ${
                    activeTab === 'destacadas'
                      ? 'text-white'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {t('competitions.tab_main') || 'Destacadas'}
                </Text>
              </Pressable>

              {/* Países individuales (España, Portugal, Italia...) */}
              {availableCountries.map((c) => {
                const isSelected = activeTab === c.code;
                const label = countryDisplayName(c.code, locale) || c.code;
                return (
                  <Pressable
                    key={c.code}
                    onPress={() => setActiveTab(c.code)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isSelected }}
                    className={`min-h-[38px] flex-row items-center gap-1.5 rounded-full px-3.5 py-1.5 border active:opacity-75 ${
                      isSelected
                        ? 'border-rose-900 bg-rose-900 dark:border-rose-700 dark:bg-rose-800 shadow-sm'
                        : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/70'
                    }`}
                  >
                    <CountryFlag code={c.code} size={16} />
                    <Text
                      className={`text-xs font-bold ${
                        isSelected
                          ? 'text-white'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}

              {/* Internacional (Europa / Mundo) */}
              {tree.international.length > 0 && (
                <Pressable
                  onPress={() => setActiveTab('international')}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: activeTab === 'international' }}
                  className={`min-h-[38px] flex-row items-center gap-1.5 rounded-full px-3.5 py-1.5 border active:opacity-75 ${
                    activeTab === 'international'
                      ? 'border-rose-900 bg-rose-900 dark:border-rose-700 dark:bg-rose-800 shadow-sm'
                      : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/70'
                  }`}
                >
                  <Ionicons
                    name="globe-outline"
                    size={14}
                    color={activeTab === 'international' ? '#ffffff' : '#0284c7'}
                  />
                  <Text
                    className={`text-xs font-bold ${
                      activeTab === 'international'
                        ? 'text-white'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {t('competitions.international') || 'Europa & Mundo'}
                  </Text>
                </Pressable>
              )}

              {/* Mis Ligas (Favoritas) */}
              <Pressable
                onPress={() => setActiveTab('favoritas')}
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === 'favoritas' }}
                className={`min-h-[38px] flex-row items-center gap-1.5 rounded-full px-3.5 py-1.5 border active:opacity-75 ${
                  activeTab === 'favoritas'
                    ? 'border-rose-900 bg-rose-900 dark:border-rose-700 dark:bg-rose-800 shadow-sm'
                    : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/70'
                }`}
              >
                <Ionicons
                  name="star"
                  size={13}
                  color={activeTab === 'favoritas' ? '#ffffff' : '#eab308'}
                />
                <Text
                  className={`text-xs font-bold ${
                    activeTab === 'favoritas'
                      ? 'text-white'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {t('competitions.tab_my_leagues') || 'Mis Ligas'}
                </Text>
                {favoriteIds.size > 0 && (
                  <View
                    className={`rounded-full px-1.5 py-0.2 ${
                      activeTab === 'favoritas'
                        ? 'bg-rose-800 dark:bg-rose-950'
                        : 'bg-slate-200 dark:bg-slate-800'
                    }`}
                  >
                    <Text
                      className={`font-mono text-[10px] font-black ${
                        activeTab === 'favoritas'
                          ? 'text-white'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {favoriteIds.size}
                    </Text>
                  </View>
                )}
              </Pressable>
            </ScrollView>
          </View>
        )}

        {/* Filtro de género discreto (Todas · Masculino · Femenino) */}
        {!isSearching && (
          <View className="mt-2 flex-row gap-1.5">
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
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  className={`flex-1 items-center justify-center rounded-lg py-1 border active:opacity-70 ${
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

      {/* ── Contenido de competiciones ───────────────────────────────────────── */}
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
          // ── Vista de Búsqueda ────────────────────────────────────────────────
          searchResults.length === 0 ? (
            <View className="py-12 items-center justify-center">
              <EmptyState
                title={t('common.no_search_results') || 'Sin resultados'}
                hint={`«${query}»`}
              />
              <Pressable
                onPress={() => setQuery('')}
                className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900 active:opacity-70"
              >
                <Text className="text-xs font-semibold text-rose-800 dark:text-rose-300">
                  Limpiar búsqueda
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <View className="border-b border-slate-100 bg-slate-50/80 px-3.5 py-2 dark:border-slate-800/60 dark:bg-slate-800/40">
                <Text className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  {searchResults.length} {searchResults.length === 1 ? 'resultado' : 'resultados'}
                </Text>
              </View>
              {searchResults.map((comp) => (
                <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
              ))}
            </View>
          )
        ) : activeTab === 'destacadas' ? (
          // ── Vista Destacadas ─────────────────────────────────────────────────
          destacadas.length === 0 ? (
            <View className="py-12 items-center justify-center px-4">
              <EmptyState
                title="Sin competiciones destacadas"
                hint="No hay competiciones que coincidan con el filtro seleccionado."
              />
            </View>
          ) : (
            <View className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <View className="border-b border-slate-100 bg-slate-50/80 px-3.5 py-2.5 dark:border-slate-800/60 dark:bg-slate-800/40 flex-row items-center justify-between">
                <Text className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  {t('competitions.featured_title') || 'Principales ligas y copas'}
                </Text>
                <Text className="text-[11px] font-semibold text-slate-400">
                  {destacadas.length}
                </Text>
              </View>
              {destacadas.map((comp) => (
                <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
              ))}
            </View>
          )
        ) : activeTab === 'favoritas' ? (
          // ── Vista Mis Ligas (Favoritas) ──────────────────────────────────────
          misLigas.length === 0 ? (
            <View className="py-12 items-center justify-center px-4">
              <EmptyState
                title={t('competitions.no_fav_leagues_title') || 'Todavía no tienes ligas favoritas'}
                hint={t('competitions.no_fav_leagues_hint') || 'Pulsa la estrella en cualquier competición para tenerla siempre a mano.'}
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
              <View className="border-b border-slate-100 bg-slate-50/80 px-3.5 py-2.5 dark:border-slate-800/60 dark:bg-slate-800/40 flex-row items-center justify-between">
                <Text className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  {t('competitions.my_leagues_title') || 'Competiciones seguidas'}
                </Text>
                <Text className="text-[11px] font-semibold text-slate-400">
                  {misLigas.length}
                </Text>
              </View>
              {misLigas.map((comp) => (
                <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
              ))}
            </View>
          )
        ) : activeTab === 'international' ? (
          // ── Vista Europa & Mundo ─────────────────────────────────────────────
          <View className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <View className="flex-row items-center justify-between border-b border-slate-100 bg-slate-50/80 px-3.5 py-2.5 dark:border-slate-800/60 dark:bg-slate-800/40">
              <View className="flex-row items-center gap-2">
                <Text className="text-base leading-none">🌍</Text>
                <Text className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  World Skate & World Skate Europe
                </Text>
              </View>
              <Text className="text-[11px] font-semibold text-slate-400">
                {tree.international.length}
              </Text>
            </View>
            {tree.international.map((comp) => (
              <CompetitionRowItem key={comp.id} comp={comp} locale={locale} t={t} />
            ))}
          </View>
        ) : selectedCountryGroup ? (
          // ── Vista del País Seleccionado (España, Portugal, Italia...) ─────────
          <CountryCatalogView
            country={selectedCountryGroup}
            openSections={openSections}
            onToggleSection={toggleSection}
            openFederations={openFederations}
            onToggleFederation={toggleFederation}
            locale={locale}
            t={t}
          />
        ) : (
          // Fallback si no hay datos del país
          <View className="py-12 items-center justify-center px-4">
            <EmptyState
              title="Sin competiciones"
              hint="No se encontraron competiciones para la selección actual."
            />
          </View>
        )}

        {/* Banner publicitario al final del catálogo */}
        <View className="mt-4">
          <AdBanner variant="list" />
        </View>
      </ScrollView>
    </View>
  );
}
