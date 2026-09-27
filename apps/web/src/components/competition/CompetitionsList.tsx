'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import type { CompetitionSummary } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { clubName, competitionName } from '@/lib/names';
import { CountryFlag } from '@/components/shared/CountryFlag';
import { useFavorites } from '@/hooks/useFavorites';
import { hasSeason2026, orderByImportance } from './order';

// ── Tipos ───────────────────────────────────────────────────────────────────

type Tab = 'mis-ligas' | 'principales' | 'todas';

// ── Helpers generales ────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

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

// ── Iconos ───────────────────────────────────────────────────────────────────

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      className={`w-[18px] h-[18px] transition-colors ${
        filled ? 'text-amber-400' : 'text-slate-300 dark:text-slate-600'
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

function CompetitionRow({
  comp,
  isFav,
  onToggleFav,
  locale,
}: {
  comp: CompetitionSummary;
  isFav: boolean;
  onToggleFav: (id: string) => void;
  locale: string;
}) {
  const { t } = useT();

  // Avatar: bandera del país (imagen, multiplataforma) o iniciales
  const hasFlag = !!comp.country && comp.country.length === 2;
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
        href={`/competitions/${comp.id}`}
        className="flex items-center gap-2.5 flex-1 py-2.5 px-3 min-w-0 rounded-xl
                   hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        {/* Avatar circular */}
        <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center overflow-hidden
                         ${hasFlag
                           ? 'bg-slate-100 dark:bg-slate-800'
                           : 'bg-rink-passion/10 border border-rink-passion/20'}`}
        >
          {hasFlag ? (
            <CountryFlag code={comp.country} className="w-full h-full object-cover" />
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
          {meta && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 leading-none">
              {meta}
            </p>
          )}
        </div>

        <ChevronRight />
      </Link>

      {/* Botón favorito */}
      <button
        onClick={() => onToggleFav(comp.id)}
        aria-label={isFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}
        className="px-2.5 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50
                   transition-colors shrink-0"
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
}: {
  region: string;
  comps: CompetitionSummary[];
  favorites: Set<string>;
  onToggleFav: (id: string) => void;
  locale: string;
}) {
  const [open, setOpen] = useState(false);

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
        <span className="text-[10px] text-slate-400 tabular-nums">{comps.length}</span>
        <ChevronDown open={open} />
      </button>
      {open && (
        <div className="pl-3">
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

// ── Acordeón de país ─────────────────────────────────────────────────────────

function CountryAccordion({
  countryCode,
  label,
  comps,
  defaultOpen,
  favorites,
  onToggleFav,
  locale,
}: {
  countryCode: string | null;
  label: string;
  comps: CompetitionSummary[];
  defaultOpen: boolean;
  favorites: Set<string>;
  onToggleFav: (id: string) => void;
  locale: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Reabrir si hay favoritos dentro
  useEffect(() => {
    if (comps.some((c) => favorites.has(c.id))) setOpen(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const national = comps.filter((c) => c.scope === 'national');
  const regional = comps.filter((c) => c.scope === 'regional');

  // Agrupar regionales por región
  const byRegion = useMemo(() => {
    const map = new Map<string, CompetitionSummary[]>();
    for (const c of regional) {
      const key = c.region ?? 'Otras';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, locale));
  }, [regional, locale]);

  return (
    <div className="border-t border-slate-100 dark:border-slate-800 first:border-t-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-1 py-3 text-left group"
        aria-expanded={open}
      >
        <CountryFlag code={countryCode} className="w-5 h-auto rounded-[2px] shrink-0" />
        <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300 flex-1
                         group-hover:text-slate-800 dark:group-hover:text-slate-100 transition-colors">
          {label}
        </span>
        <span className="text-[10px] text-slate-400 dark:text-slate-600 tabular-nums font-medium mr-1">
          {comps.length}
        </span>
        <ChevronDown open={open} />
      </button>

      {open && (
        <div className="pb-2">
          {/* Competiciones nacionales directamente */}
          {national.length > 0 && (
            <div>
              {national.map((c) => (
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

          {/* Competiciones regionales agrupadas */}
          {byRegion.length > 0 && (
            <div className={national.length > 0 ? 'mt-1 border-t border-slate-100 dark:border-slate-800 pt-1' : ''}>
              {byRegion.length === 1 && byRegion[0] ? (
                // Una sola región: mostrar directamente sin sub-acordeón
                byRegion[0][1].map((c) => (
                  <CompetitionRow
                    key={c.id}
                    comp={c}
                    isFav={favorites.has(c.id)}
                    onToggleFav={onToggleFav}
                    locale={locale}
                  />
                ))
              ) : (
                // Múltiples regiones: sub-acordeones
                byRegion.map(([region, regionComps]) => (
                  <RegionAccordion
                    key={region}
                    region={region}
                    comps={regionComps}
                    favorites={favorites}
                    onToggleFav={onToggleFav}
                    locale={locale}
                  />
                ))
              )}
            </div>
          )}
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
}: {
  comps: CompetitionSummary[];
  favorites: Set<string>;
  onToggleFav: (id: string) => void;
  locale: string;
  emptyKey: string;
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
        />
      ))}
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────

export function CompetitionsList({
  competitions,
  error,
}: {
  competitions: CompetitionSummary[];
  error: string | null;
}) {
  const { t, locale } = useT();

  const [tab, setTab]     = useState<Tab>('todas');
  const [query, setQuery] = useState('');

  // Favoritos de ligas: store compartido (rink-fav-leagues) con Ajustes y
  // "Gestionar favoritos". Antes esta lista usaba su propia clave y quedaba
  // desincronizada; ahora todo pasa por el mismo hook.
  const { leagues, toggleLeague } = useFavorites();
  const favorites = useMemo(() => new Set(leagues), [leagues]);
  const toggleFav = toggleLeague;

  // 1) Solo competiciones con temporada 2026/27 (las demás no tienen nada que enseñar)
  const relevant = useMemo(
    () => competitions.filter(hasSeason2026),
    [competitions],
  );

  // 2) Aplicar búsqueda
  const q = norm(query.trim());
  const searched = useMemo(() => {
    if (!q) return relevant;
    return relevant.filter((c) =>
      norm(c.name).includes(q) ||
      norm(c.shortName ?? '').includes(q) ||
      norm(countryDisplayName(c.country, locale)).includes(q) ||
      norm(c.region ?? '').includes(q) ||
      norm(c.organizer).includes(q),
    );
  }, [relevant, q, locale]);

  // 3) Datos por tab
  const principales = useMemo(
    () => orderByImportance(searched.filter((c) => c.scope === 'national'), locale),
    [searched, locale],
  );

  const misLigas = useMemo(
    () => orderByImportance(searched.filter((c) => favorites.has(c.id)), locale),
    [searched, favorites, locale],
  );

  // 4) Estructura para "Todas": internacional + por país (orden por importancia dentro de cada grupo)
  const { international, byCountry } = useMemo(() => {
    const intl = orderByImportance(searched.filter((c) => c.scope === 'international'), locale);
    const map = new Map<string, CompetitionSummary[]>();
    for (const c of searched.filter((c) => c.scope !== 'international')) {
      const key = c.country ?? 'ZZ';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    // Dentro de cada país, por importancia (no alfabético).
    for (const [k, arr] of map) map.set(k, orderByImportance(arr, locale));
    const sorted = [...map.entries()].sort(([a], [b]) => {
      const ks = countrySortKey(a) - countrySortKey(b);
      return ks !== 0 ? ks : countryDisplayName(a, locale).localeCompare(countryDisplayName(b, locale), locale);
    });
    return { international: intl, byCountry: sorted };
  }, [searched, locale]);

  const isSearching = q.length > 0;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-8 text-center gap-3">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('standings.no_data')}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">{error}</p>
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
               className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            aria-label={t('a11y.search_competitions')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar liga, país o federación..."
            className="w-full h-10 pl-9 pr-4 rounded-xl border border-slate-200 dark:border-slate-700
                       bg-slate-50 dark:bg-slate-900 text-[13px] text-slate-800 dark:text-slate-200
                       placeholder:text-slate-500 dark:placeholder:text-slate-500 dark:placeholder:text-slate-400
                       focus:outline-none focus:ring-2 focus:ring-rink-passion/40 focus:bg-white dark:focus:bg-slate-900
                       transition-colors"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600
                         dark:hover:text-slate-300 transition-colors"
              aria-label="Limpiar búsqueda"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* Tabs */}
        {!isSearching && (
          <div className="flex">
            {(
              [
                ['mis-ligas', 'Mis Ligas', favorites.size > 0 ? String(favorites.size) : null],
                ['principales', 'Principales', null],
                ['todas', 'Todas', null],
              ] as const
            ).map(([id, label, badge]) => (
              <button
                key={id}
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
                  <span className="w-4 h-4 rounded-full bg-amber-400 text-white text-[9px] font-bold
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

      {/* ── Contenido ──────────────────────────────────────────────────────── */}
      <div className="flex-1 px-4 py-3">

        {/* Modo búsqueda: lista plana */}
        {isSearching && (
          <FlatList
            comps={searched}
            favorites={favorites}
            onToggleFav={toggleFav}
            locale={locale}
            emptyKey="common.no_search_results"
          />
        )}

        {/* Tab: Mis Ligas */}
        {!isSearching && tab === 'mis-ligas' && (
          misLigas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
                     className="w-6 h-6 text-slate-400">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                        strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                Todavía no tienes ligas favoritas
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pulsa la estrella en cualquier competición para guardarla aquí.
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

        {/* Tab: Principales (nacionales de todos los países) */}
        {!isSearching && tab === 'principales' && (
          <FlatList
            comps={principales}
            favorites={favorites}
            onToggleFav={toggleFav}
            locale={locale}
            emptyKey="common.no_search_results"
          />
        )}

        {/* Tab: Todas — acordeón jerárquico */}
        {!isSearching && tab === 'todas' && (
          <div>
            {/* Internacional */}
            {international.length > 0 && (
              <div className="mb-1">
                <div className="flex items-center gap-2 px-1 pt-1 pb-2">
                  <span className="text-base leading-none">🌍</span>
                  <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300 flex-1">
                    Internacional
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-600 tabular-nums font-medium">
                    {international.length}
                  </span>
                </div>
                {international.map((c) => (
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

            {/* Por país */}
            <div>
              {byCountry.map(([code, comps], idx) => (
                <CountryAccordion
                  key={code}
                  countryCode={code === 'ZZ' ? null : code}
                  label={code === 'ZZ' ? 'Sin clasificar' : countryDisplayName(code, locale)}
                  comps={comps}
                  defaultOpen={idx === 0}
                  favorites={favorites}
                  onToggleFav={toggleFav}
                  locale={locale}
                />
              ))}
            </div>

            {byCountry.length === 0 && international.length === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-10">
                {t('common.no_search_results')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
