'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { track, searchEventProps } from '@/lib/analytics';
import { clubName, competitionName, playerDisplayName } from '@/lib/names';
import { TeamShield } from '@/components/shared/TeamShield';
import { PlayerAvatar } from '@/components/shared/PlayerAvatar';
import { CountryFlag } from '@/components/shared/CountryFlag';
import {
  SEARCH_MIN_LENGTH,
  isSearchable,
  normalizeSearchQuery,
  type SearchResults,
} from '@/lib/api/search';
import { tt } from './translate';

interface SearchViewProps {
  initialQuery: string;
  results: SearchResults | null;
  error: string | null;
}

/** Nombre del país en el idioma activo (mismo criterio que el listado). */
function countryLabel(code: string | null, locale: string): string {
  if (!code) return '';
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
         className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0">
      <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ROW = 'flex items-center gap-2.5 py-2.5 px-3 min-w-0 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors';

/** Cabecera de grupo con su recuento. */
function Section({ title, count, children }: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-3">
      <div className="flex items-center gap-2 px-1 pt-1 pb-1.5">
        <span className="text-[12px] font-bold text-slate-600 dark:text-slate-300 flex-1">{title}</span>
        <span className="text-[10px] text-slate-400 dark:text-slate-600 tabular-nums font-medium">{count}</span>
      </div>
      <div>{children}</div>
    </section>
  );
}

export function SearchView({ initialQuery, results, error }: SearchViewProps) {
  const { t, locale } = useT();
  const [query, setQuery] = useState(initialQuery);

  const pending = normalizeSearchQuery(query) !== normalizeSearchQuery(initialQuery);
  const canSearch = isSearchable(query);
  const total = results?.total ?? 0;

  // #240: la búsqueda global se resuelve en el servidor; `results` corresponde a
  // `initialQuery`, así que basta una emisión por resultado (incluido el caso de
  // cero resultados). Sin la query en claro (ver `searchEventProps`).
  useEffect(() => {
    if (!results || !isSearchable(initialQuery)) return;
    track('search_performed', {
      surface: 'search',
      ...searchEventProps(initialQuery, results.total),
    });
  }, [initialQuery, results]);

  return (
    <div className="flex flex-col min-h-screen max-w-2xl mx-auto">
      {/* ── Cabecera fija con el buscador ─────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white/95 dark:bg-slate-950/95 backdrop-blur-sm
                      border-b border-slate-100 dark:border-slate-800 px-4 pt-5 pb-4">
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-3">
          {tt(t, 'search.title', 'Buscar')}
        </h1>

        <form action={`/${locale}/search`} method="get" role="search">
          <div className="relative">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              name="q"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={tt(t, 'a11y.search_global', 'Buscar equipos, jugadores o competiciones')}
              placeholder={tt(t, 'search.placeholder', 'Buscar equipo, jugador o competición…')}
              className="w-full h-10 pl-9 pr-10 rounded-xl border border-slate-200 dark:border-slate-700
                         bg-slate-50 dark:bg-slate-900 text-[13px] text-slate-800 dark:text-slate-200
                         placeholder:text-slate-500 dark:placeholder:text-slate-400
                         focus:outline-none focus:ring-2 focus:ring-rink-passion focus:bg-white dark:focus:bg-slate-900
                         transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label={tt(t, 'search.clear', 'Limpiar búsqueda')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600
                           dark:hover:text-slate-300 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        </form>
      </div>

      {/* ── Contenido ─────────────────────────────────────────────────────── */}
      <div className="flex-1 px-4 py-3">
        {!canSearch ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-10">
            {tt(t, 'search.hint', 'Escribe al menos {n} letras para buscar.', { n: SEARCH_MIN_LENGTH })}
          </p>
        ) : pending ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-10">
            {tt(t, 'search.press_enter', 'Pulsa Enter para buscar.')}
          </p>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {tt(t, 'search.error', 'No se pudo completar la búsqueda. Inténtalo de nuevo.')}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">{error}</p>
          </div>
        ) : results && total === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
                   className="w-6 h-6 text-slate-400">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
              {tt(t, 'search.empty', 'No hay resultados para «{q}».', { q: initialQuery })}
            </p>
            <Link href="/competitions" className="text-[13px] font-semibold text-rink-passion hover:underline">
              {tt(t, 'search.view_all', 'Ver todas las competiciones')}
            </Link>
          </div>
        ) : results ? (
          <>
            <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 px-1 pb-2 tabular-nums">
              {tt(t, 'search.results_count', '{n} resultados', { n: total })}
            </p>

            {results.teams.length > 0 && (
              <Section title={tt(t, 'search.section_teams', 'Equipos')} count={results.teams.length}>
                {results.teams.map((team) => {
                  const country = countryLabel(team.country, locale);
                  return (
                    <Link
                      key={team.id}
                      href={`/teams/${team.id}`}
                      className={ROW}
                      onClick={() => track('search_result_clicked', { surface: 'search', kind: 'team', ref_id: team.id })}
                    >
                      <TeamShield teamId={team.id} teamName={team.name} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 truncate leading-snug">
                          {clubName(team.name)}
                        </p>
                        {country && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 leading-none">
                            {country}
                          </p>
                        )}
                      </div>
                      <ChevronRight />
                    </Link>
                  );
                })}
              </Section>
            )}

            {results.players.length > 0 && (
              <Section title={tt(t, 'search.section_players', 'Jugadores')} count={results.players.length}>
                {results.players.map((player) => {
                  const name = playerDisplayName(player.firstName, player.lastName);
                  return (
                    <Link
                      key={player.id}
                      href={`/players/${player.id}`}
                      className={ROW}
                      onClick={() => track('search_result_clicked', { surface: 'search', kind: 'player', ref_id: player.id })}
                    >
                      <PlayerAvatar photoUrl={player.photoUrl} name={name} className="w-9 h-9 rounded-full" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 truncate leading-snug">
                          {name}
                        </p>
                        {player.teamName && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 leading-none">
                            {clubName(player.teamName)}
                          </p>
                        )}
                      </div>
                      <ChevronRight />
                    </Link>
                  );
                })}
              </Section>
            )}

            {results.competitions.length > 0 && (
              <Section title={tt(t, 'search.section_competitions', 'Competiciones')} count={results.competitions.length}>
                {results.competitions.map((comp) => {
                  const name = competitionName(comp.name, comp.nameI18n, locale);
                  const hasFlag = !!comp.country && comp.country.length === 2;
                  const meta = [countryLabel(comp.country, locale), comp.seasonName].filter(Boolean).join(' · ');
                  return (
                    <Link
                      key={comp.id}
                      href={`/competitions/${comp.id}`}
                      className={ROW}
                      onClick={() => track('search_result_clicked', { surface: 'search', kind: 'competition', ref_id: comp.id })}
                    >
                      <div className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center overflow-hidden
                                       ${hasFlag ? 'bg-slate-100 dark:bg-slate-800' : 'bg-rink-passion/10 border border-rink-passion/20'}`}>
                        {hasFlag ? (
                          <CountryFlag code={comp.country} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[10px] font-black text-rink-passion leading-none">
                            {(comp.shortName ?? comp.name).slice(0, 2).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 truncate leading-snug">
                          {clubName(name)}
                        </p>
                        {meta && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5 leading-none">
                            {meta}
                          </p>
                        )}
                      </div>
                      <ChevronRight />
                    </Link>
                  );
                })}
              </Section>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
