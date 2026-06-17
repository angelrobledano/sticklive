'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useFavorites } from '@/hooks/useFavorites';
import { TeamShield } from '@/components/shared/TeamShield';
import { clubName } from '@/lib/names';
import { useT } from '@/lib/i18n';
import { BackLink } from '@/components/shared/BackLink';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';
const SEASON_ID = process.env['NEXT_PUBLIC_SEASON_ID'] ?? '';

interface TeamItem { id: string; name: string; shortName: string | null }
interface LeagueItem { id: string; name: string; shortName: string | null }
interface CompItem {
  id: string; name: string; shortName: string | null;
  season?: { id: string; isCurrent?: boolean; teamCount?: number } | null;
}

/**
 * Temporada para listar equipos. Usa NEXT_PUBLIC_SEASON_ID si está; si no,
 * la deriva de /competitions (la "actual" con más equipos). Así no depende de
 * un id horneado en el build, que puede quedar vacío/obsoleto tras un reseed.
 */
function pickSeasonId(comps: CompItem[]): string | null {
  const withSeason = comps.filter((c) => c.season?.id);
  const current = withSeason.filter((c) => c.season?.isCurrent);
  const pool = current.length ? current : withSeason;
  pool.sort((a, b) => (b.season?.teamCount ?? 0) - (a.season?.teamCount ?? 0));
  return pool[0]?.season?.id ?? null;
}

/**
 * Gestionar favoritos: edición en bloque de equipos y ligas seguidos.
 * Buscador + listas con estrella grande por fila para activar/desactivar
 * en masa sin entrar en cada perfil.
 */
function FavoritesInner() {
  const { isFavorite, toggle, isLeagueFavorite, toggleLeague, mounted } = useFavorites();
  const { t } = useT();
  const searchParams = useSearchParams();
  const onboarding = searchParams.get('onboarding') === '1';
  const [query, setQuery] = useState('');
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [leagues, setLeagues] = useState<LeagueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/competitions`)
      .then((r) => r.json()).catch(() => null)
      .then(async (comps) => {
        const compList = (comps?.competitions ?? []) as CompItem[];
        setLeagues(compList.map((c) => ({ id: c.id, name: c.name, shortName: c.shortName })));

        // Preferimos la temporada ACTUAL real de /competitions; el env solo como
        // último recurso (puede estar vacío u obsoleto, que era justo el problema).
        const seasonId = pickSeasonId(compList) || SEASON_ID;
        if (!seasonId) return;
        const st = await fetch(`${API_URL}/seasons/${seasonId}/standings`)
          .then((r) => r.json()).catch(() => null);
        const list: TeamItem[] = ((st?.standings ?? []) as Array<Record<string, string | null>>)
          .map((s) => ({
            id: (s['team_id'] ?? s['teamId']) as string,
            name: (s['team_name'] ?? s['teamName'] ?? '') as string,
            shortName: (s['team_short_name'] ?? s['teamShortName'] ?? null) as string | null,
          }))
          .filter((tm) => tm.id);
        setTeams(list.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  const q = query.trim().toLowerCase();
  const filteredTeams = useMemo(
    () => teams.filter((t) => !q || t.name.toLowerCase().includes(q) || (t.shortName ?? '').toLowerCase().includes(q)),
    [teams, q]
  );
  const filteredLeagues = useMemo(
    () => leagues.filter((l) => !q || l.name.toLowerCase().includes(q)),
    [leagues, q]
  );

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
        <Link href="/" className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-rink-passion transition-colors">
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

      {/* Buscador */}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('favorites.search_placeholder')}
        className="w-full min-h-[48px] px-4 rounded-xl border border-slate-200 dark:border-slate-700
                   bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-200
                   placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rink-passion/40"
      />

      {loading ? (
        <div className="py-10 flex justify-center">
          <div className="w-5 h-5 rounded-full border-2 border-rink-passion/30 border-t-rink-passion animate-spin" />
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

          {!loading && filteredTeams.length === 0 && filteredLeagues.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-600">
              Nada que coincida con &ldquo;{query}&rdquo;
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

export default function FavoritesPage() {
  return (
    <Suspense fallback={null}>
      <FavoritesInner />
    </Suspense>
  );
}
