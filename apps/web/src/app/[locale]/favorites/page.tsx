'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useSearchParams } from 'next/navigation';
import { useFavorites } from '@/hooks/useFavorites';
import { TeamShield } from '@/components/shared/TeamShield';
import { clubName } from '@/lib/names';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';
import { track } from '@/lib/analytics';
import { BackLink } from '@/components/shared/BackLink';
import { selectSeasonCandidates, mergeStandingTeams, filterFavorites, type RawStandingRow } from '@/lib/favorites-catalog';
import { getCurrentMatchesFresh, type Match } from '@/lib/api/client';
import { MiGrada } from '@/components/home/MiGrada';
import { madridTodayKey } from '@/lib/match-time';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';
const SEASON_ID = process.env['NEXT_PUBLIC_SEASON_ID'] ?? '';

interface TeamItem { id: string; name: string; shortName: string | null }
interface LeagueItem { id: string; name: string; shortName: string | null }
interface CompItem {
  id: string; name: string; shortName: string | null;
  season?: { id: string; isCurrent?: boolean; teamCount?: number } | null;
}

import { favoritesCatalogState } from './state';

/**
 * Gestionar favoritos: edición en bloque de equipos y ligas seguidos.
 * Buscador + listas con estrella grande por fila para activar/desactivar
 * en masa sin entrar en cada perfil.
 */
function FavoritesInner() {
  const { favorites, leagues: favLeagues, players, isFavorite, toggle, isLeagueFavorite, toggleLeague, mounted } = useFavorites();
  const { t } = useT();
  const searchParams = useSearchParams();
  const onboarding = searchParams.get('onboarding') === '1';
  const [query, setQuery] = useState('');
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [leagues, setLeagues] = useState<LeagueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Nº de favoritos elegidos (para medir la activación guiada).
  const favCount = () => {
    try {
      return (JSON.parse(localStorage.getItem('rink-favorites') ?? '[]') as string[]).length
        + (JSON.parse(localStorage.getItem('rink-fav-leagues') ?? '[]') as string[]).length
        + (JSON.parse(localStorage.getItem('rink-fav-players') ?? '[]') as string[]).length;
    } catch { return 0; }
  };

  useEffect(() => {
    if (onboarding) track('onboarding_started', { entry: 'favorites' });
  }, [onboarding]);

  // #344: carga del catálogo reutilizable (reintento). Los fallos de API son
  // explícitos: `loadError` distingue "no hay datos" de "no se pudieron cargar".
  // Las standings 404 se toleran por temporada, pero un fallo de red o un 500
  // de /competitions NO se disfraza de catálogo vacío.
  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`${API_URL}/competitions`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const comps = await res.json();
      const compList = (comps?.competitions ?? []) as CompItem[];
      setLeagues(compList.map((c) => ({ id: c.id, name: c.name, shortName: c.shortName })));

      // Cargamos los equipos de VARIAS temporadas actuales (las de más equipos)
      // y los agregamos deduplicando. Así una temporada con standings 404 no
      // deja el buscador vacío. El env solo es respaldo si no hay competiciones.
      const seasonIds = selectSeasonCandidates(compList, { envSeasonId: SEASON_ID });
      if (seasonIds.length === 0) return;
      const lists = await Promise.all(
        seasonIds.map(async (sid) => {
          const st = await fetch(`${API_URL}/seasons/${sid}/standings`)
            .then((r) => (r.ok ? r.json() : null));
          return ((st?.standings ?? []) as RawStandingRow[]);
        })
      );
      setTeams(mergeStandingTeams(lists));
    } catch {
      // Un fallo de red o de API no es un catálogo vacío (#344).
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  // Mi grada (spec 2026-10-16): próximos y últimos resultados de lo que sigues.
  // Sale de la home y vive aquí. Es un extra: si la carga falla, no se pinta y
  // la gestión de favoritos sigue funcionando igual.
  const followsTeamsOrLeagues = mounted && (favorites.length > 0 || favLeagues.length > 0);
  const [gradaMatches, setGradaMatches] = useState<Match[]>([]);
  useEffect(() => {
    if (!followsTeamsOrLeagues) return;
    let cancelled = false;
    getCurrentMatchesFresh()
      .then((ms) => { if (!cancelled) setGradaMatches(ms); })
      .catch((err: unknown) => { console.warn('[favoritos] Mi grada no disponible', err); });
    return () => { cancelled = true; };
  }, [followsTeamsOrLeagues]);

  const filteredTeams = useMemo(() => filterFavorites(teams, query), [teams, query]);
  const filteredLeagues = useMemo(() => filterFavorites(leagues, query), [leagues, query]);

  // #269: onboarding real para quien aún no sigue nada (antes la pantalla solo
  // mostraba "Nada que coincida" con la query vacía). `mounted` evita el
  // parpadeo de hidratación mientras el hook lee localStorage.
  const hasAnyFavorites = favorites.length > 0 || favLeagues.length > 0 || players.length > 0;
  const noMatches = filteredTeams.length === 0 && filteredLeagues.length === 0;

  // #344: precedencia de estados (error > vacío). Ver favoritosCatalogState.
  const catalogState = favoritesCatalogState({
    loading,
    hasError: loadError,
    mounted,
    hasAnyFavorites,
    query,
    matchCount: filteredTeams.length + filteredLeagues.length,
  });

  const handleToggle = (kind: 'team' | 'league', id: string, name: string) => {
    const wasActive = kind === 'team' ? isFavorite(id) : isLeagueFavorite(id);
    if (kind === 'team') toggle(id); else toggleLeague(id);
    setToast(t(wasActive ? 'favorites.toast_unfollowed' : 'favorites.toast_following', { name }));
  };

  const Row = ({ id, name, shortName, kind }: { id: string; name: string; shortName: string | null; kind: 'team' | 'league' }) => {
    const active = kind === 'team' ? isFavorite(id) : isLeagueFavorite(id);
    return (
      <button
        onClick={() => handleToggle(kind, id, shortName ?? clubName(name))}
        className="w-full flex items-center gap-3 px-4 py-2 min-h-[52px] text-left
                   hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
        aria-pressed={active}
      >
        {kind === 'team' ? (
          <TeamShield teamId={id} teamName={shortName ?? name} size={28} />
        ) : (
          <div className="w-7 h-7 rounded-lg bg-rink-passion/10 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-black text-rink-passion">{(shortName ?? name).slice(0, 2).toUpperCase()}</span>
          </div>
        )}
        <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
          {clubName(name)}
        </span>
        <svg viewBox="0 0 24 24"
             fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.6}
             className={`w-6 h-6 shrink-0 transition-all duration-200 ${
               active ? 'text-rink-passion scale-110' : 'text-slate-300 dark:text-slate-600'
             }`}>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                strokeLinejoin="round" />
        </svg>
      </button>
    );
  };

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4 pb-28">
      {onboarding ? (
        <Link href="/" onClick={() => track('onboarding_completed', { skipped: true, favorites_selected: favCount() })}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-rink-passion transition-colors">
          {t('favorites.onboarding_skip')}
        </Link>
      ) : (
        <BackLink href="/settings" />
      )}

      <div>
        <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t('favorites.manage_favs')}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
          {t('favorites.manage_help')}
        </p>
      </div>

      {!onboarding && followsTeamsOrLeagues && gradaMatches.length > 0 && (
        <MiGrada
          matches={gradaMatches}
          teamIds={favorites}
          leagueIds={favLeagues}
          todayKey={madridTodayKey()}
          showManage={false}
        />
      )}

      {/* Buscador — X propia (la nativa de type=search está oculta en la app) */}
      <div className="relative">
        <input
          type="search"
          aria-label={t('favorites.search_placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('favorites.search_placeholder')}
          className="w-full min-h-[48px] px-4 pr-12 rounded-xl border border-slate-200 dark:border-slate-700
                     bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200
                     placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rink-passion dark:focus:ring-rink-accent"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center
                       w-11 h-11 rounded-full text-slate-500 dark:text-slate-400 hover:text-slate-600
                       dark:hover:text-slate-300 transition-colors"
            aria-label={tt(t, 'a11y.clear_search', 'Limpiar búsqueda')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {catalogState === 'loading' ? (
        <div className="py-10 flex justify-center" aria-busy="true">
          <div className="w-5 h-5 rounded-full border-2 border-rink-passion/30 border-t-rink-passion animate-spin" aria-hidden="true" />
        </div>
      ) : catalogState === 'error' ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
          <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
                 className="w-6 h-6 text-rink-passion" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {tt(t, 'favorites.load_error_title', 'No hemos podido cargar tus favoritos')}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
            {tt(t, 'favorites.load_error_body', 'Ha habido un problema de conexión. No has perdido tus favoritos: inténtalo de nuevo.')}
          </p>
          <button
            onClick={() => void loadCatalog()}
            className="mt-1 inline-flex items-center justify-center gap-1.5 px-5 min-h-[44px] rounded-xl
                       text-[13px] font-semibold bg-rink-passion text-white
                       hover:bg-rink-passion/90 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent focus-visible:ring-offset-2"
          >
            {tt(t, 'errors.retry', 'Reintentar')}
          </button>
        </div>
      ) : catalogState === 'onboarding' ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
          <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
                 className="w-6 h-6 text-slate-500 dark:text-slate-400" aria-hidden="true">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {t('favorites.onboarding_title')}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">
            {t('favorites.onboarding_body')}
          </p>
          <Link
            href="/competitions"
            className="mt-1 inline-flex items-center justify-center gap-1.5 px-4 min-h-[44px] rounded-xl
                       text-[13px] font-semibold bg-rink-passion text-white
                       hover:bg-rink-passion/90 transition-colors"
          >
            {t('favorites.onboarding_cta')}
          </Link>
        </div>
      ) : (
        <>
          {filteredLeagues.length > 0 && (
            <section className="card overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('favorites.leagues')}</span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {filteredLeagues.map((l) => <Row key={l.id} {...l} kind="league" />)}
              </div>
            </section>
          )}

          {filteredTeams.length > 0 && (
            <section className="card overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('favorites.teams')}</span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {filteredTeams.map((t) => <Row key={t.id} {...t} kind="team" />)}
              </div>
            </section>
          )}

          {noMatches && query.trim().length > 0 && (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {tt(t, 'favorites.no_results', 'Nada que coincida con «{q}»', { q: query })}
            </p>
          )}
        </>
      )}

      {mounted && toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60]
                        flex items-center gap-2 px-4 py-2.5 rounded-full
                        bg-slate-900/95 dark:bg-slate-100/95 shadow-lg
                        text-xs font-medium text-white dark:text-slate-900
                        animate-[fadeIn_.15s_ease-out] whitespace-nowrap"
             role="status">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-rink-passion">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          {toast}
        </div>
      )}

      {/* Onboarding: paso siguiente claro tras elegir favoritos. Por encima de la
          barra inferior en móvil (bottom-20) y flotante en escritorio. */}
      {onboarding && (
        <div className="fixed inset-x-0 bottom-20 md:bottom-6 z-[55] px-4 pointer-events-none">
          <div className="max-w-2xl mx-auto pointer-events-auto">
            <Link
              href="/"
              onClick={() => track('onboarding_completed', { skipped: false, favorites_selected: favCount() })}
              className="flex items-center justify-center gap-2 w-full min-h-[50px] rounded-xl
                         bg-rink-passion text-white text-sm font-bold shadow-lg
                         hover:opacity-90 transition-opacity"
            >
              {t('favorites.onboarding_done')}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-4 h-4">
                <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Fallback de `<Suspense>` mientras `useSearchParams` suspende en SSR/prerender.
 * Antes era `null` y el HTML inicial de /favorites llegaba en blanco. Ahora
 * renderiza la cabecera real y un spinner, para que la carga en frío no parezca
 * rota (#269). El contenido con datos sigue siendo de cliente (fetch).
 */
function FavoritesFallback() {
  const { t } = useT();
  return (
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4 pb-28" aria-busy="true">
      <div>
        <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">{t('favorites.manage_favs')}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-1">
          {t('favorites.manage_help')}
        </p>
      </div>
      <div className="py-10 flex justify-center">
        <div className="w-5 h-5 rounded-full border-2 border-rink-passion/30 border-t-rink-passion animate-spin" aria-hidden="true" />
      </div>
    </div>
  );
}

export default function FavoritesPage() {
  return (
    <Suspense fallback={<FavoritesFallback />}>
      <FavoritesInner />
    </Suspense>
  );
}
