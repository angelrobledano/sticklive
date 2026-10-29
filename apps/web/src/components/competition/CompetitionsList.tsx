'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useRouter } from 'next/navigation';
import * as Sentry from '@sentry/nextjs';
import type { CompetitionSummary, Federation } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { track, searchEventProps } from '@/lib/analytics';
import { clubName, competitionName } from '@/lib/names';
import { CountryFlag } from '@/components/shared/CountryFlag';
import { filterCompetitions, normalizeSearchText, orderSearchResults } from '@/components/search/competition-filter';
import { tt } from '@/components/search/translate';
import { useFavorites } from '@/hooks/useFavorites';
import { currentSeasonYear, hasSeasonYear, orderByImportance } from '@/lib/competition-importance';
import {
  buildCompetitionTree, countryHubPath, federationHubPath, filterByGender,
  type CountrySections, type GenderFilter,
} from '@/lib/competition-groups';
import { competitionPath } from '@/lib/competition-path';
import { FeaturedCompetitions } from './FeaturedCompetitions';

// ── Tipos ───────────────────────────────────────────────────────────────────

type Tab = 'destacadas' | 'paises' | 'mis-ligas';

/**
 * #358: navegación del patrón ARIA tabs (roving tabindex). Devuelve el índice
 * destino para flechas/Home/End, o el mismo si la tecla no aplica. Función pura.
 */
export function nextTabIndex(current: number, key: string, count: number): number {
  if (count <= 0) return -1;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown': return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':   return (current - 1 + count) % count;
    case 'Home':      return 0;
    case 'End':       return count - 1;
    default:          return current;
  }
}

/** Orden estable de las tabs (índice → id) para el roving tabindex. */
const TAB_ORDER = ['destacadas', 'paises', 'mis-ligas'] as const satisfies readonly Tab[];

// ── Helpers generales ────────────────────────────────────────────────────────

function countryDisplayName(code: string | null, locale: string): string {
  if (!code) return '';
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch { return code; }
}

function genderLabel(gender: string | null, t: (k: string) => string): string {
  if (gender === 'male') return t('common.male');
  if (gender === 'female') return t('common.female');
  return '';
}

const COUNTRY_ORDER = ['ES', 'PT', 'IT', 'FR', 'AR', 'AN'];

function countrySortKey(code: string | null): number {
  const i = COUNTRY_ORDER.indexOf((code ?? '').toUpperCase());
  return i === -1 ? 100 : i;
}

/**
 * #339: estructura del listado para el grafo de enlaces HTML. Los acordeones
 * solo montan en el DOM las filas de los países abiertos (9/105 competiciones
 * enlazadas); al renderizar también un índice completo y siempre presente, este
 * orden pasa al HTML inicial, que es lo que descubren los crawlers.
 *
 * Internacional aparte; el resto por país (orden fijo del producto) y dentro de
 * cada país por importancia. Función pura, testeable sin navegador.
 */
export interface CompetitionsIndex {
  international: CompetitionSummary[];
  byCountry: [string, CompetitionSummary[]][];
}

export function groupCompetitionsForIndex(
  competitions: CompetitionSummary[],
  locale: string,
): CompetitionsIndex {
  const international = orderByImportance(
    competitions.filter((c) => c.scope === 'international'),
    locale,
  );
  const map = new Map<string, CompetitionSummary[]>();
  for (const c of competitions.filter((c) => c.scope !== 'international')) {
    const key = c.country ?? 'ZZ';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  for (const [k, arr] of map) map.set(k, orderByImportance(arr, locale));
  const byCountry = [...map.entries()].sort(([a], [b]) => {
    const ks = countrySortKey(a) - countrySortKey(b);
    return ks !== 0 ? ks : countryDisplayName(a, locale).localeCompare(countryDisplayName(b, locale), locale);
  });
  return { international, byCountry };
}

// ── Iconos ───────────────────────────────────────────────────────────────────

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      className={`w-[18px] h-[18px] transition-colors ${
        filled ? 'text-rink-passion' : 'text-slate-300 dark:text-slate-600'
      }`}
    >
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
         className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0">
      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
         className={`w-3.5 h-3.5 text-slate-500 dark:text-slate-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}>
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Tarjeta de competición (compacta) ────────────────────────────────────────

export function CompetitionRow({
  comp,
  isFav,
  onToggleFav,
  locale,
  onSelect,
  status = null,
}: {
  comp: CompetitionSummary;
  isFav: boolean;
  onToggleFav: (id: string) => void;
  locale: string;
  /** Click de navegación al detalle (instrumentado en modo búsqueda, #240). */
  onSelect?: () => void;
  /** Estado corto (en juego, próximo partido) delante de los metadatos. */
  status?: { text: string; live: boolean } | null;
}) {
  const { t } = useT();

  // Avatar: bandera del país (imagen, multiplataforma), globo para las
  // competiciones del Mundo (country='W', sin bandera de un solo país) o
  // iniciales como último recurso
  const hasLogo = !!comp.logoUrl;
  const hasFlag = !!comp.country && comp.country.length === 2;
  const isWorld = comp.country === 'W';
  const initials = (comp.shortName ?? comp.name).slice(0, 2).toUpperCase();

  // Línea de metadatos
  const parts: string[] = [];
  if (comp.season?.teamCount) parts.push(`${comp.season.teamCount} ${t('common.teams_lc')}`);
  const gl = genderLabel(comp.gender, t);
  if (gl) parts.push(gl);
  if (comp.season?.name) parts.push(comp.season.name);
  const meta = parts.join(' · ');

  return (
    <div className="flex items-center gap-0 group">
      {/* Área principal: navega al detalle */}
      <Link
        href={competitionPath(comp.id, comp.slug)}
        onClick={onSelect}
        className="flex items-center gap-2.5 flex-1 py-2.5 px-3 min-w-0 rounded-xl
                   hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        {/* Avatar circular */}
        <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center overflow-hidden
                         ${hasLogo
                           ? 'bg-white border border-slate-200 dark:border-slate-700 p-0.5'
                           : hasFlag
                             ? 'bg-slate-100 dark:bg-slate-800'
                             : 'bg-rink-passion/10 border border-rink-passion/20'}`}
        >
          {hasLogo ? (
            <img
              src={comp.logoUrl!}
              alt=""
              width={32}
              height={32}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-contain"
            />
          ) : hasFlag ? (
            <CountryFlag code={comp.country} className="w-full h-full object-cover" />
          ) : isWorld ? (
            <span className="text-base leading-none" role="img" aria-label="Mundo">🌍</span>
          ) : (
            <span className="text-[10px] font-black text-rink-passion leading-none">
              {initials}
            </span>
          )}
        </div>

        {/* Textos */}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 truncate leading-snug">
            {clubName(competitionName(comp.name, comp.nameI18n, locale))}
          </p>
          {(meta || status) && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 leading-none">
              {status && (
                <span className={`font-semibold ${status.live ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}`}>
                  {status.live && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle animate-pulse" aria-hidden="true" />}
                  {status.text}
                </span>
              )}
              {status && meta ? ' · ' : ''}
              {meta}
            </p>
          )}
        </div>

        <ChevronRight />
      </Link>

      {/* Botón favorito */}
      <button
        onClick={() => onToggleFav(comp.id)}
        aria-label={tt(
          t,
          isFav ? 'a11y.remove_favorite' : 'a11y.add_favorite',
          isFav ? 'Quitar de favoritos' : 'Añadir a favoritos',
        )}
        className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl
                   hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors shrink-0"
      >
        <StarIcon filled={isFav} />
      </button>
    </div>
  );
}

// ── Sub-acordeón de región ───────────────────────────────────────────────────

function RegionAccordion({
  region,
  comps,
  favorites,
  onToggleFav,
  locale,
  href,
  defaultOpen = false,
}: {
  region: string;
  comps: CompetitionSummary[];
  favorites: Set<string>;
  onToggleFav: (id: string) => void;
  locale: string;
  /** Hub de la federación, si existe. */
  href?: string;
  defaultOpen?: boolean;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left rounded-lg
                   hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        aria-expanded={open}
      >
        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex-1 truncate">
          {region}
        </span>
        <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">{comps.length}</span>
        <ChevronDown open={open} />
      </button>
      {open && (
        <div className="pl-3">
          {href && (
            <Link href={href} className="block px-3 py-1 text-[11px] font-semibold text-rink-passion dark:text-rink-accent hover:underline">
              {tt(t, 'competitions.view_federation', 'Ver la federación')}
            </Link>
          )}
          {comps.map((c) => (
            <CompetitionRow
              key={c.id}
              comp={c}
              isFav={favorites.has(c.id)}
              onToggleFav={onToggleFav}
              locale={locale}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Secciones de un país (listado y hub) ─────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
      {children}
    </p>
  );
}

/**
 * Ligas sénior · Copas · Base · Federaciones autonómicas. Lo usan el acordeón
 * del listado y el hub de país (/competitions/country/[code]).
 * `regionalCollapsed`: en el listado las autonómicas van plegadas; en el hub, abiertas.
 */
export function CountrySectionsView({
  sections,
  favorites,
  onToggleFav,
  locale,
  regionalCollapsed = true,
}: {
  sections: CountrySections;
  favorites: Set<string>;
  onToggleFav: (id: string) => void;
  locale: string;
  regionalCollapsed?: boolean;
}) {
  const { t } = useT();
  const rows = (list: CompetitionSummary[]) => list.map((c) => (
    <CompetitionRow key={c.id} comp={c} isFav={favorites.has(c.id)} onToggleFav={onToggleFav} locale={locale} />
  ));
  return (
    <div>
      {sections.leagues.length > 0 && (
        <div><SectionTitle>{tt(t, 'competitions.section_leagues', 'Ligas')}</SectionTitle>{rows(sections.leagues)}</div>
      )}
      {sections.cups.length > 0 && (
        <div><SectionTitle>{tt(t, 'competitions.section_cups', 'Copas')}</SectionTitle>{rows(sections.cups)}</div>
      )}
      {sections.base.length > 0 && (
        <div><SectionTitle>{tt(t, 'competitions.section_base', 'Categorías de base')}</SectionTitle>{rows(sections.base)}</div>
      )}
      {sections.regional.length > 0 && (
        <div>
          <SectionTitle>{tt(t, 'competitions.section_regional', 'Federaciones autonómicas')}</SectionTitle>
          {sections.regional.map((g) => (
            <RegionAccordion
              key={g.key}
              region={g.federation ? `${g.label} · ${g.federation.shortName}` : (g.label || tt(t, 'competitions.other_region', 'Otras'))}
              href={g.federation ? federationHubPath(g.federation.slug) : undefined}
              comps={g.comps}
              favorites={favorites}
              onToggleFav={onToggleFav}
              locale={locale}
              defaultOpen={!regionalCollapsed}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Acordeón de país ─────────────────────────────────────────────────────────

function CountryAccordion({
  countryCode,
  label,
  total,
  sections,
  defaultOpen,
  favorites,
  onToggleFav,
  locale,
}: {
  countryCode: string | null;
  label: string;
  total: number;
  sections: CountrySections;
  defaultOpen: boolean;
  favorites: Set<string>;
  onToggleFav: (id: string) => void;
  locale: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-slate-100 dark:border-slate-800 first:border-t-0">
      <div className="flex items-center">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex-1 flex items-center gap-2 px-1 py-3 text-left group min-w-0"
          aria-expanded={open}
        >
          <CountryFlag code={countryCode} className="w-5 h-auto rounded-[2px] shrink-0" />
          <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300 flex-1 truncate
                           group-hover:text-slate-800 dark:group-hover:text-slate-100 transition-colors">
            {label}
          </span>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums font-medium mr-1">
            {total}
          </span>
          <ChevronDown open={open} />
        </button>
        {countryCode && (
          <Link
            href={countryHubPath(countryCode)}
            className="ml-1 px-2 py-2 text-[11px] font-semibold text-rink-passion dark:text-rink-accent hover:underline whitespace-nowrap"
          >
            {tt(t, 'competitions.view_country', 'Ver todo')}
          </Link>
        )}
      </div>
      {open && (
        <div className="pb-2">
          <CountrySectionsView sections={sections} favorites={favorites} onToggleFav={onToggleFav} locale={locale} />
        </div>
      )}
    </div>
  );
}

// ── Lista plana (búsqueda / Principales / Mis Ligas) ───────────────────────

function FlatList({
  comps,
  favorites,
  onToggleFav,
  locale,
  emptyKey,
  onSelectResult,
}: {
  comps: CompetitionSummary[];
  favorites: Set<string>;
  onToggleFav: (id: string) => void;
  locale: string;
  emptyKey: string;
  /** Resultado de búsqueda seleccionado (#240). */
  onSelectResult?: (id: string) => void;
}) {
  const { t } = useT();
  if (comps.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-10">
        {t(emptyKey)}
      </p>
    );
  }
  return (
    <div>
      {comps.map((c) => (
        <CompetitionRow
          key={c.id}
          comp={c}
          isFav={favorites.has(c.id)}
          onToggleFav={onToggleFav}
          locale={locale}
          onSelect={onSelectResult ? () => onSelectResult(c.id) : undefined}
        />
      ))}
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────

export function CompetitionsList({
  competitions,
  federations,
  error,
}: {
  competitions: CompetitionSummary[];
  /** Árbol de federaciones (orden de países y autonómicas). Opcional: sin él se ordena por nombre. */
  federations?: Federation[];
  error: string | null;
}) {
  const { t, locale } = useT();

  const router = useRouter();

  // #347: el detalle técnico del fallo (p. ej. "API 500 - /competitions: ...")
  // va a observabilidad, nunca al DOM.
  useEffect(() => {
    if (error) Sentry.captureMessage(error, 'error');
  }, [error]);

  const [tab, setTab]     = useState<Tab>('destacadas');
  const [gender, setGender] = useState<GenderFilter>('all');
  const [query, setQuery] = useState('');

  // #358: patrón ARIA tabs con roving tabindex y navegación por flechas.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const i = TAB_ORDER.indexOf(tab);
    const next = nextTabIndex(i, e.key, TAB_ORDER.length);
    if (next < 0 || next === i) return;
    e.preventDefault();
    setTab(TAB_ORDER[next]!);
    tabRefs.current[next]?.focus();
  };

  // Favoritos de ligas: store compartido (rink-fav-leagues) con Ajustes y
  // "Gestionar favoritos". Antes esta lista usaba su propia clave y quedaba
  // desincronizada; ahora todo pasa por el mismo hook.
  const { leagues, toggleLeague } = useFavorites();
  const favorites = useMemo(() => new Set(leagues), [leagues]);
  const toggleFav = toggleLeague;

  // 1) Solo competiciones con la temporada vigente. El año se DERIVA del listado
  //    (no hardcodeado): en 2027 la portada no queda vacía (#172).
  const seasonYear = useMemo(() => currentSeasonYear(competitions), [competitions]);
  const relevant = useMemo(
    () => competitions.filter((c) => seasonYear != null && hasSeasonYear(c, seasonYear)),
    [competitions, seasonYear],
  );

  // 2) Aplicar búsqueda. IMPORTANTE: se busca sobre TODAS las competiciones,
  //    no solo las de la temporada vigente (#256): una competición cuya última
  //    temporada no contiene el año actual (Copa del Rey, Europeo Sub-17…)
  //    debe poder encontrarse igualmente. Su temporada se muestra en la fila.
  const q = normalizeSearchText(query.trim());
  const searched = useMemo(() => {
    if (!q) return relevant;
    const matches = filterCompetitions(competitions, query, (code) => countryDisplayName(code, locale));
    // #260: los resultados se ordenan por relevancia (exacto/prefijo primero) y,
    // en empate, por importancia. Antes se pintaban en el orden que daba la API.
    return orderSearchResults(matches, q, locale);
  }, [competitions, relevant, q, query, locale]);

  // 3) Datos por tab
  const visible = useMemo(() => filterByGender(searched, gender), [searched, gender]);

  const misLigas = useMemo(
    () => orderByImportance(searched.filter((c) => favorites.has(c.id)), locale),
    [searched, favorites, locale],
  );

  // 4) Estructura para "Todas": internacional + por país (orden por importancia
  //    dentro de cada grupo). Reutilizada por el índice enlazado (#339).
  const tree = useMemo(
    () => buildCompetitionTree(visible, locale, federations, (code) => countryDisplayName(code, locale)),
    [visible, locale, federations],
  );

  // #339: índice completo (todas las competiciones, no solo la temporada
  // vigente) para el grafo de enlaces HTML.
  const indexGroups = useMemo(
    () => groupCompetitionsForIndex(competitions, locale),
    [competitions, locale],
  );

  const isSearching = q.length > 0;

  // #240: telemetría de búsqueda local. Se debouncea para no emitir en cada
  // tecla y no incluye la query en claro (ver `searchEventProps`).
  const lastSearchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!q) return;
    const signature = `${q}:${searched.length}`;
    const timer = setTimeout(() => {
      if (lastSearchRef.current === signature) return;
      lastSearchRef.current = signature;
      track('search_performed', {
        surface: 'competitions',
        ...searchEventProps(q, searched.length),
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [q, searched.length]);

  const handleResultClick = (id: string) => {
    track('search_result_clicked', {
      surface: 'competitions',
      kind: 'competition',
      ref_id: id,
    });
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-8 text-center gap-3">
        <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-900/20
                        flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
               className="w-6 h-6 text-rink-passion" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {tt(t, 'errors.competitions_load_title', 'No hemos podido cargar las competiciones')}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {tt(t, 'errors.load_body', 'Ha habido un problema de conexión. Inténtalo de nuevo en unos segundos.')}
        </p>
        <button
          onClick={() => router.refresh()}
          className="mt-1 inline-flex items-center gap-2
                     bg-rink-passion hover:bg-rink-passion-light active:bg-rink-passion-dark
                     text-white font-semibold text-sm
                     px-5 py-2.5 rounded-xl transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent focus-visible:ring-offset-2"
        >
          {tt(t, 'errors.retry', 'Reintentar')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen max-w-2xl mx-auto">
      {/* ── Cabecera fija ───────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white/95 dark:bg-slate-950/95 backdrop-blur-sm
                      border-b border-slate-100 dark:border-slate-800 px-4 pt-5 pb-0">
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-3">
          {t('navigation.competitions')}
        </h1>

        {/* Buscador */}
        <div className="relative mb-3">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
               className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400 pointer-events-none">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            aria-label={t('a11y.search_competitions')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tt(t, 'competitions.search_placeholder', 'Buscar liga, país o federación...')}
            className="w-full min-h-[44px] pl-9 pr-12 rounded-xl border border-slate-200 dark:border-slate-700
                       bg-slate-50 dark:bg-slate-900 text-[13px] text-slate-800 dark:text-slate-200
                       placeholder:text-slate-500 dark:placeholder:text-slate-500 dark:placeholder:text-slate-400
                       focus:outline-none focus:ring-2 focus:ring-rink-passion dark:focus:ring-rink-accent focus:bg-white dark:focus:bg-slate-900
                       transition-colors"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center
                         w-11 h-11 rounded-full text-slate-500 dark:text-slate-400 hover:text-slate-600
                         dark:hover:text-slate-300 transition-colors"
              aria-label={tt(t, 'a11y.clear_search', 'Limpiar búsqueda')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* Tabs (#358: patrón ARIA tabs) */}
        {!isSearching && (
          <div role="tablist" aria-label={tt(t, 'a11y.competitions_tabs', 'Secciones de la lista')} onKeyDown={onTabKeyDown} className="flex">
            {(
              [
                ['destacadas', tt(t, 'competitions.tab_main', 'Destacadas'), null],
                ['paises', tt(t, 'competitions.tab_all', 'Países'), null],
                ['mis-ligas', tt(t, 'competitions.tab_my_leagues', 'Mis Ligas'), favorites.size > 0 ? String(favorites.size) : null],
              ] as const
            ).map(([id, label, badge], i) => (
              <button
                key={id}
                ref={(el) => { tabRefs.current[i] = el; }}
                role="tab"
                id={`cl-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`cl-panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id as Tab)}
                className={`relative flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold
                            transition-colors whitespace-nowrap ${
                  tab === id
                    ? 'text-rink-passion'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {label}
                {badge && (
                  <span className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold
                                   flex items-center justify-center leading-none">
                    {badge}
                  </span>
                )}
                {tab === id && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-rink-passion rounded-t-full" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Filtro de género (no en Mis Ligas: ahí manda lo que sigues) */}
      {!isSearching && tab !== 'mis-ligas' && (
        <div className="flex gap-1.5 px-4 pt-3" role="group" aria-label={tt(t, 'competitions.gender_filter', 'Filtrar por género')}>
          {([
            ['all', tt(t, 'competitions.gender_all', 'Todas')],
            ['male', t('common.male')],
            ['female', t('common.female')],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setGender(id)}
              aria-pressed={gender === id}
              className={`px-3 min-h-[32px] rounded-full text-[12px] font-semibold transition-colors ${
                gender === id
                  ? 'bg-rink-passion text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Contenido ──────────────────────────────────────────────────────── */}
      <div
        className="flex-1 px-4 py-3"
        role={!isSearching ? 'tabpanel' : undefined}
        id={!isSearching ? `cl-panel-${tab}` : undefined}
        aria-labelledby={!isSearching ? `cl-tab-${tab}` : undefined}
      >

        {/* Modo búsqueda: lista plana (busca en todas las temporadas, #256) */}
        {isSearching && (
          <>
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 px-1 pb-2 tabular-nums">
              {tt(t, 'search.results_count', '{n} resultados', { n: searched.length })}
            </p>
            {searched.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 gap-3 text-center px-4">
                <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
                       className="w-6 h-6 text-slate-500 dark:text-slate-400">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                  {tt(t, 'search.no_results_for', 'Sin resultados para «{q}»', { q: query.trim() })}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {tt(t, 'search.searched_all_seasons', 'Se busca en todas las temporadas.')}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {tt(t, 'search.competitions_total', 'Hay {n} competiciones en total.', { n: competitions.length })}
                </p>
                <button
                  onClick={() => setQuery('')}
                  className="mt-1 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold
                             bg-rink-passion text-white hover:bg-rink-passion/90 transition-colors"
                >
                  {tt(t, 'search.view_all', 'Ver todas las competiciones')}
                </button>
              </div>
            ) : (
              <FlatList
                comps={searched}
                favorites={favorites}
                onToggleFav={toggleFav}
                locale={locale}
                emptyKey="common.no_search_results"
                onSelectResult={handleResultClick}
              />
            )}
          </>
        )}

        {/* Tab: Mis Ligas */}
        {!isSearching && tab === 'mis-ligas' && (
          misLigas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
                     className="w-6 h-6 text-slate-500 dark:text-slate-400">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                        strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                {tt(t, 'competitions.no_fav_leagues_title', 'Todavía no tienes ligas favoritas')}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {tt(t, 'competitions.no_fav_leagues_hint', 'Pulsa la estrella en cualquier competición para guardarla aquí.')}
              </p>
            </div>
          ) : (
            <FlatList
              comps={misLigas}
              favorites={favorites}
              onToggleFav={toggleFav}
              locale={locale}
              emptyKey="common.no_search_results"
            />
          )
        )}

        {/* Tab: Destacadas — principales fijas, copas cerca de sus fechas y
            segundo nivel por país (spec 2026-10-29, lib/competitions-home). */}
        {!isSearching && tab === 'destacadas' && (
          <FeaturedCompetitions comps={visible} favorites={favorites} onToggleFav={toggleFav} />
        )}

        {/* Tab: Países — internacional + árbol país → federación */}
        {!isSearching && tab === 'paises' && (
          <div>
            {tree.international.length > 0 && (
              <div className="mb-1">
                <div className="flex items-center gap-2 px-1 pt-1 pb-2">
                  <span className="text-base leading-none">🌍</span>
                  <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300 flex-1">
                    {tt(t, 'competitions.international', 'Internacional')}
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums font-medium">
                    {tree.international.length}
                  </span>
                </div>
                {tree.international.map((c) => (
                  <CompetitionRow
                    key={c.id}
                    comp={c}
                    isFav={favorites.has(c.id)}
                    onToggleFav={toggleFav}
                    locale={locale}
                  />
                ))}
              </div>
            )}

            <div>
              {tree.countries.map((g, idx) => (
                <CountryAccordion
                  key={g.code}
                  countryCode={g.code === 'ZZ' ? null : g.code}
                  label={g.code === 'ZZ' ? tt(t, 'competitions.unclassified', 'Sin clasificar') : countryDisplayName(g.code, locale)}
                  total={g.total}
                  sections={g.sections}
                  defaultOpen={idx === 0}
                  favorites={favorites}
                  onToggleFav={toggleFav}
                  locale={locale}
                />
              ))}
            </div>

            {tree.countries.length === 0 && tree.international.length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-10">
                {t('common.no_search_results')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* #339: índice completo de competiciones para el grafo de enlaces HTML.
          Los acordeones montan sus filas solo al abrirse (hoy 9/105 enlazadas);
          este índice viaja SIEMPRE en el HTML inicial (plegado, no oculto) para
          que el crawler descubra todo el listado. */}
      {competitions.length > 0 && (
        <details className="px-4 pb-8">
          <summary className="cursor-pointer select-none py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {tt(t, 'competitions.all_index', 'Todas las competiciones ({n})', { n: competitions.length })}
          </summary>
          <nav aria-label={tt(t, 'a11y.competitions_index', 'Todas las competiciones')} className="pt-1">
            {indexGroups.international.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {tt(t, 'competitions.international', 'Internacional')}
                </p>
                <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {indexGroups.international.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={competitionPath(c.id, c.slug)}
                        className="text-[12px] text-slate-600 dark:text-slate-300 hover:text-rink-passion dark:hover:text-rink-accent hover:underline"
                      >
                        {clubName(competitionName(c.name, c.nameI18n, locale))}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {indexGroups.byCountry.map(([code, comps]) => (
              <div key={code} className="mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {code === 'ZZ' ? tt(t, 'competitions.unclassified', 'Sin clasificar') : countryDisplayName(code, locale)}
                </p>
                <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {comps.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={competitionPath(c.id, c.slug)}
                        className="text-[12px] text-slate-600 dark:text-slate-300 hover:text-rink-passion dark:hover:text-rink-accent hover:underline"
                      >
                        {clubName(competitionName(c.name, c.nameI18n, locale))}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </details>
      )}
    </div>
  );
}
