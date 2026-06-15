'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type { CompetitionSummary } from '@/lib/api/client';
import { useT } from '@/lib/i18n';
import { clubName } from '@/lib/names';

// ── Helpers ───────────────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function countryName(code: string | null, locale: string): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch { return code; }
}

function countryFlag(code: string | null): string {
  if (!code || code.length !== 2) return '';
  const base = 0x1F1E6 - 'A'.charCodeAt(0);
  return String.fromCodePoint(
    base + code.toUpperCase().charCodeAt(0),
    base + code.toUpperCase().charCodeAt(1),
  );
}

/** Etiqueta legible de federación — clave para agrupar y filtrar */
function fedLabel(c: CompetitionSummary, locale: string): string {
  if (c.scope === 'regional') return c.region ?? c.organizer;
  if (c.scope === 'international') return 'Internacional';
  return countryName(c.country, locale) ?? c.organizer;
}

/** Clave de ordenación: favoritas > activas > más recientes > nombre */
function compSortKey(c: CompetitionSummary, favs: Set<string>): [number, number, string] {
  return [
    favs.has(c.id) ? 0 : 1,
    (c.season?.isCurrent ?? false) ? 0 : 1,
    (c.season?.startDate ? String(9999 - parseInt(c.season.startDate.slice(0, 4), 10)) : '9999') + c.name,
  ];
}

const COUNTRY_PRIORITY = ['ES', 'PT', 'IT', 'FR', 'AR'];

/** Clave numérica para ordenar federaciones: nacional ES primero, luego regionales ES, luego otras */
function fedSortKey(fed: string, locale: string, competitions: CompetitionSummary[]): number {
  const rep = competitions.find((c) => fedLabel(c, locale) === fed);
  if (!rep) return 999;
  const ci = COUNTRY_PRIORITY.indexOf((rep.country ?? '').toUpperCase());
  const base = ci === -1 ? 100 : ci * 10;
  if (rep.scope === 'national') return base;
  if (rep.scope === 'regional') return base + 1;
  if (rep.scope === 'international') return 50;
  return 999;
}

// ── Favoritos en localStorage ─────────────────────────────────────────────────

const FAV_KEY = 'sl_fav_comps';

function loadFavs(): Set<string> {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

function saveFavs(favs: Set<string>) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); } catch { /* noop */ }
}

// ── Icono estrella ────────────────────────────────────────────────────────────

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'}
         stroke="currentColor" strokeWidth={1.5}
         className={`w-4 h-4 transition-colors ${filled ? 'text-amber-400' : 'text-slate-300 dark:text-slate-600'}`}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Card de competición ───────────────────────────────────────────────────────

function CompetitionCard({ comp, fed, isFav, onToggleFav }: {
  comp: CompetitionSummary;
  fed: string;
  isFav: boolean;
  onToggleFav: (id: string) => void;
}) {
  const { t } = useT();
  const isActive = comp.season?.isCurrent ?? false;

  return (
    <div className="card flex items-stretch overflow-hidden hover:shadow-md transition-shadow">
      {/* Zona principal: navega al detalle */}
      <Link
        href={`/competitions/${comp.id}`}
        className="flex items-center gap-3 flex-1 p-4 min-w-0"
      >
        {/* Iniciales / logo */}
        <div className="w-10 h-10 rounded-xl bg-rink-passion/10 border border-rink-passion/20
                        flex items-center justify-center shrink-0">
          <span className="text-xs font-black text-rink-passion">
            {(comp.shortName ?? comp.name).slice(0, 2).toUpperCase()}
          </span>
        </div>

        {/* Nombre + badges */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate leading-snug">
              {clubName(comp.name)}
            </p>
            {isActive && (
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500 mt-0.5" title="En curso" />
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {/* Badge de federación */}
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400
                             bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded leading-none">
              {fed}
            </span>
            {comp.gender && (
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {comp.gender === 'male' ? t('common.male') : comp.gender === 'female' ? t('common.female') : null}
              </span>
            )}
          </div>
        </div>

        {/* Estadísticas de temporada */}
        <div className="text-right shrink-0">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            {comp.season?.teamCount ?? 0} {t('common.teams_lc')}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            {comp.season?.matchCount ?? 0} {t('common.matches_lc')}
          </p>
        </div>

        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
             className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0 ml-1">
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>

      {/* Botón de favorito — separado del Link para no interferir con la navegación */}
      <button
        onClick={(e) => { e.preventDefault(); onToggleFav(comp.id); }}
        aria-label={isFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}
        className="px-3 flex items-center border-l border-slate-100 dark:border-slate-800
                   hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors shrink-0"
      >
        <StarIcon filled={isFav} />
      </button>
    </div>
  );
}

// ── Sección acordeón por federación ──────────────────────────────────────────

function FedSection({ fed, comps, isOpen, onToggle, favorites, onToggleFav, countryCode }: {
  fed: string;
  comps: CompetitionSummary[];
  isOpen: boolean;
  onToggle: () => void;
  favorites: Set<string>;
  onToggleFav: (id: string) => void;
  countryCode: string | null;
}) {
  const sorted = useMemo(() => {
    return [...comps].sort((a, b) => {
      const [a0, a1, a2] = compSortKey(a, favorites);
      const [b0, b1, b2] = compSortKey(b, favorites);
      if (a0 !== b0) return a0 - b0;
      if (a1 !== b1) return a1 - b1;
      return a2.localeCompare(b2);
    });
  }, [comps, favorites]);

  const activeCount = comps.filter((c) => c.season?.isCurrent).length;

  return (
    <section>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-1 py-2.5 text-left group"
        aria-expanded={isOpen}
      >
        {countryCode && (
          <span className="text-base leading-none">{countryFlag(countryCode)}</span>
        )}
        <span className="text-[11px] font-bold uppercase tracking-widest
                         text-slate-500 dark:text-slate-400 flex-1
                         group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors">
          {fed}
        </span>
        {activeCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-500 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            {activeCount}
          </span>
        )}
        <span className="text-[10px] text-slate-400 dark:text-slate-600 tabular-nums">
          {comps.length}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
             className={`w-3.5 h-3.5 text-slate-400 dark:text-slate-600 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {isOpen && (
        <div className="space-y-2 pb-3">
          {sorted.map((comp) => (
            <CompetitionCard
              key={comp.id}
              comp={comp}
              fed={fed}
              isFav={favorites.has(comp.id)}
              onToggleFav={onToggleFav}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

const AGE_ORDER = ['senior', 'juvenil', 'junior', 'infantil', 'alevin', 'benjamin', 'prebenjamin', 'veteranos', 'base'];

export function CompetitionsList({ competitions, error }: {
  competitions: CompetitionSummary[];
  error: string | null;
}) {
  const { t, locale } = useT();

  // ── Filtros ────────────────────────────────────────────────────────────────
  const [query,        setQuery]        = useState('');
  const [fedFilter,    setFedFilter]    = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [ageFilter,    setAgeFilter]    = useState<string>('senior');

  // ── Favoritos (localStorage, hidratados tras montaje) ─────────────────────
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  useEffect(() => { setFavorites(loadFavs()); }, []);

  const toggleFav = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveFavs(next);
      return next;
    });
  }, []);

  // ── Acordeón: qué federaciones están abiertas ──────────────────────────────
  const [openFeds, setOpenFeds] = useState<Set<string>>(new Set());

  const toggleFed = useCallback((fed: string) => {
    setOpenFeds((prev) => {
      const next = new Set(prev);
      if (next.has(fed)) next.delete(fed); else next.add(fed);
      return next;
    });
  }, []);

  // ── Opciones de filtro disponibles ─────────────────────────────────────────
  const availableAges = useMemo(() => {
    const present = new Set(competitions.map((c) => c.ageCategory ?? 'senior'));
    return AGE_ORDER.filter((a) => present.has(a));
  }, [competitions]);

  const hasGenders = useMemo(() => {
    const g = new Set(competitions.map((c) => c.gender ?? ''));
    return g.has('male') && g.has('female');
  }, [competitions]);

  /** Todas las federaciones únicas, ordenadas por relevancia */
  const allFeds = useMemo(() => {
    const fedSet = new Set(competitions.map((c) => fedLabel(c, locale)));
    return Array.from(fedSet).sort((a, b) => {
      const diff = fedSortKey(a, locale, competitions) - fedSortKey(b, locale, competitions);
      return diff !== 0 ? diff : a.localeCompare(b, locale);
    });
  }, [competitions, locale]);

  // Abrir la primera federación por defecto; también abrir las que tengan favoritos
  useEffect(() => {
    if (allFeds.length === 0) return;
    setOpenFeds((prev) => {
      if (prev.size > 0) return prev; // ya inicializado
      return new Set([allFeds[0]!]);
    });
  }, [allFeds]);

  useEffect(() => {
    if (favorites.size === 0) return;
    const fedsWithFavs = competitions
      .filter((c) => favorites.has(c.id))
      .map((c) => fedLabel(c, locale));
    if (fedsWithFavs.length > 0) {
      setOpenFeds((prev) => new Set([...prev, ...fedsWithFavs]));
    }
  }, [favorites, competitions, locale]);

  // ── Competiciones filtradas ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return competitions.filter((c) => {
      // El filtro de género aplica siempre
      if (genderFilter !== 'all' && c.gender !== genderFilter) return false;
      if (q) {
        // Buscando: ignorar edad y federación; buscar en todos los campos
        return (
          norm(c.name).includes(q) ||
          norm(c.shortName ?? '').includes(q) ||
          norm(fedLabel(c, locale)).includes(q) ||
          norm(countryName(c.country, locale) ?? '').includes(q) ||
          norm(c.ageCategory ?? '').includes(q)
        );
      }
      // Sin búsqueda: aplicar filtro de edad y federación
      if ((c.ageCategory ?? 'senior') !== ageFilter) return false;
      if (fedFilter !== null && fedLabel(c, locale) !== fedFilter) return false;
      return true;
    });
  }, [competitions, query, fedFilter, genderFilter, ageFilter, locale]);

  /** Grupos por federación para el acordeón, ordenados por relevancia */
  const fedGroups = useMemo(() => {
    const map = new Map<string, CompetitionSummary[]>();
    for (const c of filtered) {
      const key = fedLabel(c, locale);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const diff = fedSortKey(a, locale, competitions) - fedSortKey(b, locale, competitions);
      return diff !== 0 ? diff : a.localeCompare(b, locale);
    });
  }, [filtered, locale, competitions]);

  const isSearching = query.trim().length > 0;

  /** Competiciones favoritas que pasan los filtros activos */
  const favComps = useMemo(
    () => filtered.filter((c) => favorites.has(c.id)),
    [filtered, favorites],
  );

  // Ordenación para la lista plana (búsqueda o favoritos)
  const flatSort = useCallback((list: CompetitionSummary[]) =>
    [...list].sort((a, b) => {
      const [a0, a1, a2] = compSortKey(a, favorites);
      const [b0, b1, b2] = compSortKey(b, favorites);
      if (a0 !== b0) return a0 - b0;
      if (a1 !== b1) return a1 - b1;
      return a2.localeCompare(b2);
    }),
  [favorites]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-8 text-center gap-3">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('standings.no_data')}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 font-mono">{error}</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
        {t('navigation.competitions')}
      </h1>

      {/* ── Buscador ──────────────────────────────────────────────────────── */}
      <div className="relative">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
             className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('common.search_competitions')}
          aria-label={t('common.search_competitions')}
          className="w-full min-h-[44px] pl-10 pr-4 rounded-xl border border-slate-200 dark:border-slate-700
                     bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200
                     placeholder:text-slate-400 dark:placeholder:text-slate-500
                     focus:outline-none focus:ring-2 focus:ring-rink-passion/40"
        />
      </div>

      {/* ── Chips de género ────────────────────────────────────────────────── */}
      {hasGenders && !isSearching && (
        <div className="flex gap-2">
          {(['all', 'male', 'female'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGenderFilter(g)}
              className={`px-3.5 py-1.5 min-h-[36px] rounded-full text-xs font-semibold
                          whitespace-nowrap transition-colors ${
                genderFilter === g
                  ? 'bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {g === 'all' ? 'Todos' : g === 'male' ? t('common.male') : t('common.female')}
            </button>
          ))}
        </div>
      )}

      {/* ── Chips de categoría de edad ────────────────────────────────────── */}
      {!isSearching && availableAges.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
          {availableAges.map((age) => (
            <button
              key={age}
              onClick={() => setAgeFilter(age)}
              className={`px-3.5 py-1.5 min-h-[36px] rounded-full text-xs font-semibold
                          whitespace-nowrap transition-colors shrink-0 ${
                ageFilter === age
                  ? 'bg-rink-passion text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {t(`age_categories.${age}`)}
            </button>
          ))}
        </div>
      )}

      {/* ── Chips de federación ────────────────────────────────────────────── */}
      {!isSearching && allFeds.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
          <button
            onClick={() => setFedFilter(null)}
            className={`px-3.5 py-1.5 min-h-[36px] rounded-full text-xs font-semibold
                        whitespace-nowrap transition-colors shrink-0 ${
              fedFilter === null
                ? 'bg-slate-700 dark:bg-slate-200 text-white dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            Todas
          </button>
          {allFeds.map((fed) => (
            <button
              key={fed}
              onClick={() => {
                setFedFilter((prev) => (prev === fed ? null : fed));
                // Auto-expand la federación seleccionada
                setOpenFeds((prev) => new Set([...prev, fed]));
              }}
              className={`px-3.5 py-1.5 min-h-[36px] rounded-full text-xs font-semibold
                          whitespace-nowrap transition-colors shrink-0 ${
                fedFilter === fed
                  ? 'bg-slate-700 dark:bg-slate-200 text-white dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {fed}
            </button>
          ))}
        </div>
      )}

      {/* ── Vista de búsqueda: lista plana ─────────────────────────────────── */}
      {isSearching && (
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">
              {t('common.no_search_results')}
            </p>
          ) : (
            flatSort(filtered).map((comp) => (
              <CompetitionCard
                key={comp.id}
                comp={comp}
                fed={fedLabel(comp, locale)}
                isFav={favorites.has(comp.id)}
                onToggleFav={toggleFav}
              />
            ))
          )}
        </div>
      )}

      {/* ── Vista normal: favoritos fijados + acordeones por federación ──── */}
      {!isSearching && (
        <div className="space-y-1">
          {/* Sección de favoritos (fija en la parte superior) */}
          {favComps.length > 0 && (
            <section className="pb-2 border-b border-slate-100 dark:border-slate-800 mb-2">
              <div className="flex items-center gap-2 px-1 py-2">
                <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={0.5}
                     className="w-3.5 h-3.5 text-amber-400">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                <span className="text-[11px] font-bold uppercase tracking-widest text-amber-500 dark:text-amber-400">
                  {t('favorites.my_favorites')}
                </span>
              </div>
              <div className="space-y-2">
                {flatSort(favComps).map((comp) => (
                  <CompetitionCard
                    key={comp.id}
                    comp={comp}
                    fed={fedLabel(comp, locale)}
                    isFav
                    onToggleFav={toggleFav}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Acordeones por federación */}
          {fedGroups.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8">
              {t('common.no_search_results')}
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {fedGroups.map(([fed, comps]) => {
                const rep = comps[0]!;
                // Solo mostramos bandera si es una competición nacional
                const cc = rep.scope === 'national' ? rep.country : null;
                // Cuando hay filtro de federación activo, ese acordeón siempre está abierto
                const isOpen = fedFilter === fed || openFeds.has(fed);
                return (
                  <FedSection
                    key={fed}
                    fed={fed}
                    comps={comps}
                    isOpen={isOpen}
                    onToggle={() => toggleFed(fed)}
                    favorites={favorites}
                    onToggleFav={toggleFav}
                    countryCode={cc}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
