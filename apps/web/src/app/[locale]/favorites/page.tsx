'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useFavorites } from '@/hooks/useFavorites';
import { TeamShield } from '@/components/shared/TeamShield';
import { clubName } from '@/lib/names';
import { useT } from '@/lib/i18n';
import { BackLink } from '@/components/shared/BackLink';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';
const SEASON_ID = process.env['NEXT_PUBLIC_SEASON_ID'] ?? '';

interface TeamItem { id: string; name: string; shortName: string | null }
interface LeagueItem { id: string; name: string; shortName: string | null }

/**
 * Gestionar favoritos: edición en bloque de equipos y ligas seguidos.
 * Buscador + listas con estrella grande por fila para activar/desactivar
 * en masa sin entrar en cada perfil.
 */
export default function FavoritesPage() {
  const { isFavorite, toggle, isLeagueFavorite, toggleLeague, mounted } = useFavorites();
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [leagues, setLeagues] = useState<LeagueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      SEASON_ID
        ? fetch(`${API_URL}/seasons/${SEASON_ID}/standings`).then((r) => r.json()).catch(() => null)
        : Promise.resolve(null),
      fetch(`${API_URL}/competitions`).then((r) => r.json()).catch(() => null),
    ]).then(([st, comps]) => {
      const list: TeamItem[] = (st?.standings ?? []).map((s: Record<string, string | null>) => ({
        id: (s['team_id'] ?? s['teamId']) as string,
        name: (s['team_name'] ?? s['teamName'] ?? '') as string,
        shortName: (s['team_short_name'] ?? s['teamShortName'] ?? null) as string | null,
      })).filter((t: TeamItem) => t.id);
      setTeams(list.sort((a, b) => a.name.localeCompare(b.name)));
      setLeagues(((comps?.competitions ?? []) as Array<{ id: string; name: string; shortName: string | null }>)
        .map((c) => ({ id: c.id, name: c.name, shortName: c.shortName })));
    }).finally(() => setLoading(false));
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
    <div className="px-4 py-4 max-w-2xl mx-auto space-y-4 pb-24">
      <BackLink href="/settings" />

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
    </div>
  );
}
