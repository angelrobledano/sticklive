'use client';

import { useMemo } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { TeamShield } from '@/components/shared/TeamShield';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';
import { clubName } from '@/lib/names';
import { competitionPath } from '@/lib/competition-path';
import { favoriteTeamCards, type CardMatch, type FavoriteTeamCard } from '@/lib/favorites-view';

/**
 * «Lo que sigo» (05/11/2026). Patrón de FotMob («Following») y Flashscore
 * («Favoritos»): Favoritos deja de ser solo un formulario de gestión y pasa a
 * enseñar cada equipo con su directo, su próximo partido y su último
 * resultado. La gestión vive en «Editar».
 */
export function FavoritesOverview<M extends CardMatch>({ teamIds, matches, teamNames, leagues, players, editHref }: {
  teamIds: readonly string[];
  matches: readonly M[];
  teamNames: Readonly<Record<string, string>>;
  leagues: readonly { id: string; name: string; slug?: string | null; logoUrl?: string | null }[];
  players: readonly { id: string; name: string }[];
  editHref: string;
}) {
  const { t, locale } = useT();
  const cards = useMemo(() => favoriteTeamCards(teamIds, matches, Date.now(), teamNames), [teamIds, matches, teamNames]);
  const when = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), [locale]);

  const header = (label: string) => (
    <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-800/40">
      <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</h2>
    </div>
  );

  const rival = (c: FavoriteTeamCard<M>, m: M) => clubName(m.homeTeam.id === c.id ? m.awayTeam.name : m.homeTeam.name);
  const isHome = (c: FavoriteTeamCard<M>, m: M) => m.homeTeam.id === c.id;
  const outcome = (c: FavoriteTeamCard<M>, m: M): 'W' | 'D' | 'L' | null => {
    const h = m.score.home, a = m.score.away;
    if (h == null || a == null) return null;
    const mine = isHome(c, m) ? h : a, theirs = isHome(c, m) ? a : h;
    return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
  };
  const OUTCOME_STYLE = { W: 'bg-emerald-600 text-white', D: 'bg-slate-400 text-white', L: 'bg-rose-600 text-white' } as const;
  const OUTCOME_LETTER = { W: tt(t, 'favorites.win_short', 'V'), D: tt(t, 'favorites.draw_short', 'E'), L: tt(t, 'favorites.loss_short', 'D') };

  return (
    <div className="space-y-4">
      {cards.length > 0 && (
        <section className="card overflow-hidden">
          {header(t('favorites.teams'))}
          <ul className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {cards.map((c) => (
              <li key={c.id}>
                <Link href={`/teams/${c.id}`} className="flex min-h-[64px] items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <TeamShield teamId={c.id} teamName={c.name} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{clubName(c.name) || '—'}</p>
                    {c.live ? (
                      <p className="truncate text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 align-middle" aria-hidden="true" />
                        {tt(t, 'favorites.live_now', 'En directo')} · {c.live.score.home ?? 0}-{c.live.score.away ?? 0} {isHome(c, c.live) ? 'vs' : '@'} {rival(c, c.live)}
                      </p>
                    ) : c.next ? (
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {c.next.scheduledAt ? when.format(new Date(c.next.scheduledAt)) : ''} · {isHome(c, c.next) ? 'vs' : '@'} {rival(c, c.next)}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400">{tt(t, 'favorites.no_upcoming', 'Sin partidos próximos')}</p>
                    )}
                  </div>
                  {c.last && outcome(c, c.last) && (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-slate-600 dark:text-slate-300"
                          title={`${clubName(c.last.homeTeam.name)} ${c.last.score.home}-${c.last.score.away} ${clubName(c.last.awayTeam.name)}`}>
                      {c.last.score.home}-{c.last.score.away}
                      <span className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${OUTCOME_STYLE[outcome(c, c.last)!]}`}>
                        {OUTCOME_LETTER[outcome(c, c.last)!]}
                      </span>
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {leagues.length > 0 && (
        <section className="card overflow-hidden">
          {header(t('favorites.leagues'))}
          <ul className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {leagues.map((l) => (
              <li key={l.id}>
                <Link href={competitionPath(l.id, l.slug)} className="flex min-h-[52px] items-center gap-3 px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  {l.logoUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={l.logoUrl} alt="" width={28} height={28} loading="lazy" className="h-7 w-7 shrink-0 object-contain" />
                    : <span className="h-7 w-7 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" aria-hidden="true" />}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-200">{clubName(l.name)}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden="true">
                    <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {players.length > 0 && (
        <section className="card overflow-hidden">
          {header(tt(t, 'favorites.players', 'Jugadores'))}
          <ul className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {players.map((p) => (
              <li key={p.id}>
                <Link href={`/players/${p.id}`} className="flex min-h-[48px] items-center px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/60">
                  {p.name || '—'}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link href={editHref}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 text-sm font-semibold text-slate-600 hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-50">
        + {tt(t, 'favorites.add_more', 'Seguir más equipos o ligas')}
      </Link>
    </div>
  );
}
