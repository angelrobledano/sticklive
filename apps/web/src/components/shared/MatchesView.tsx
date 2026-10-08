'use client';

import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react';
import type { Match } from '@/lib/api/client';
import { useFavorites } from '@/hooks/useFavorites';
import { useLiveScores } from '@/hooks/useLiveScores';
import { DateSelector } from '@/components/shared/DateSelector';
import { MatchCard } from '@/components/shared/MatchCard';
import { TeamShield } from '@/components/shared/TeamShield';
import { UpcomingGroup } from '@/components/shared/UpcomingGroup';
import { MiGrada } from '@/components/home/MiGrada';
import { LiveBoard } from '@/components/home/LiveBoard';
import { AdBanner } from '@/components/shared/AdBanner';
import { adsenseConfig, listAdInsertIndex } from '@/lib/ads';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { madridDateKey, madridTodayKey, addDaysToKey, dayDiff } from '@/lib/match-time';
import { groupUpcomingByDay } from '@/lib/upcoming';
import { importanceRank } from '@/lib/competition-importance';
import { tt } from '@/components/search/translate';

/** Nº de partidos favoritos visibles antes de colapsar el resto */
const FAV_PREVIEW = 3;

/** Config AdSense (env inyectado en build). */
const ADS = adsenseConfig();

// ─── Anuncio del directo en la home (#361) ───────────────────────────────────

export interface LiveScoreChange {
  id: string;
  homeName: string;
  awayName: string;
  home: number;
  away: number;
  kind: 'goal' | 'start' | 'end';
}

function teamLabel(team: Match['homeTeam']): string {
  return team?.shortName ?? team?.name ?? '';
}

/** Instante del partido (o 0 si falta / es inválido) para ordenar establemente. */
function timeOf(m: Match): number {
  const iso = m.scheduledAt ?? m.startedAt;
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * #361: compara la lista previa con la nueva y devuelve SOLO los cambios
 * anunciables (gol, inicio o final) de partidos que YA estaban en la lista.
 * Ignora altas/bajas (evita ruido) y correcciones de partidos finalizados.
 */
export function diffLiveScores(prev: Match[], next: Match[]): LiveScoreChange[] {
  const byId = new Map(prev.map((m) => [m.id, m]));
  const out: LiveScoreChange[] = [];
  for (const m of next) {
    const before = byId.get(m.id);
    if (!before) continue;
    const scoreChanged = before.score.home !== m.score.home || before.score.away !== m.score.away;
    const endedNow = before.status !== 'finished' && m.status === 'finished';
    const startedNow = before.status !== 'live' && m.status === 'live';
    const base = {
      id: m.id,
      homeName: teamLabel(m.homeTeam) || m.homeTeamId,
      awayName: teamLabel(m.awayTeam) || m.awayTeamId,
      home: m.score.home ?? 0,
      away: m.score.away ?? 0,
    };
    if (endedNow) out.push({ ...base, kind: 'end' });
    else if (scoreChanged && m.status === 'live') out.push({ ...base, kind: 'goal' });
    else if (startedNow) out.push({ ...base, kind: 'start' });
  }
  return out;
}

/**
 * Escena del estado vacío — "una jugada, una vez": la bola entra en la portería
 * UNA sola vez al montar (la red vibra y se enciende el esmeralda ~300 ms) y la
 * escena queda en calma. Sin bucle perpetuo: no hay partido en juego, así que no
 * hay movimiento continuo. Reutiliza los @keyframes rink* de globals.css, que
 * respetan reduce-motion (dejan la escena estática). Decorativa: aria-hidden.
 */
function EmptyRinkScene() {
  // `both` fija el fotograma final para que la animación no "vuelva" al inicio.
  const once = (name: string, duration: string, ease = 'ease-out') => ({
    animation: `${name} ${duration} ${ease} both`,
  });
  return (
    <div aria-hidden="true" className="relative mx-auto mb-2 h-20 w-64 select-none">
      {/* Línea de pista (se "dibuja" una vez) */}
      <span
        className="rink-empty-anim absolute inset-x-4 bottom-6 h-px origin-left bg-slate-300 dark:bg-slate-600"
        style={once('rinkDraw', '0.9s')}
      />
      {/* Portería (marco + red ligera), apoyada en la línea */}
      <svg viewBox="0 0 54 40"
           className="rink-empty-anim absolute bottom-6 right-3 h-10 w-14 text-slate-500 dark:text-slate-400"
           style={once('rinkNetHit', '1.8s')}
           fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
        <path d="M2 2v36M52 2v36M2 2h50" />
        <path d="M2 14h50M2 26h50" strokeWidth={0.5} />
        <path d="M18 2v36M36 2v36" strokeWidth={0.5} />
      </svg>
      {/* Bola (apoyada en la línea) */}
      <span
        className="rink-empty-anim absolute bottom-6 left-10 h-3 w-3 rounded-full bg-rink-passion shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
        style={once('rinkBall', '1.8s', 'cubic-bezier(0.16,1,0.3,1)')}
      />
      {/* Destello de gol (invisible salvo el instante del gol) */}
      <svg viewBox="0 0 24 24"
           className="rink-empty-anim absolute bottom-12 right-8 h-5 w-5 text-emerald-500 opacity-0"
           style={once('rinkFlash', '1.8s')}
           fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l1.8 1.8M16.2 16.2L18 18M18 6l-1.8 1.8M7.8 16.2L6 18" />
      </svg>
    </div>
  );
}

/**
 * Carril de contexto en escritorio (xl+): "Mi grada" (si sigues a alguien),
 * próximos partidos y, si no sigues a nadie, una llamada a explorar
 * competiciones. Reutiliza datos ya calculados, sin peticiones nuevas.
 * Se mantiene pegado con scroll interno para no empujar la página.
 */
function DesktopAside({
  matches, hasFavorites, favorites, leagues, todayKey, selectedDate, showUpcoming = true, className = '',
}: {
  matches: Match[];
  hasFavorites: boolean;
  favorites: string[];
  leagues: string[];
  todayKey: string;
  selectedDate: string;
  /** false cuando los próximos ya se muestran en la vista principal (#414). */
  showUpcoming?: boolean;
  className?: string;
}) {
  const { t } = useT();
  // Próximos = días POSTERIORES al que se está viendo. Los partidos del día
  // seleccionado ya están en la lista principal; repetirlos aquí sería ruido.
  const upcoming = useMemo(() => {
    return matches
      .filter((m) => {
        const k = madridDateKey(m.scheduledAt);
        return !!k && k > selectedDate;
      })
      .sort((a, b) => ((a.scheduledAt ?? '') < (b.scheduledAt ?? '') ? -1 : 1))
      .slice(0, 5);
  }, [matches, selectedDate]);

  return (
    <aside className={`shrink-0 ${className}`}>
      <div className="rail-scroll sticky top-[76px] flex max-h-[calc(100vh-92px)]
                      flex-col gap-5 overflow-y-auto pb-1">
        {/* "Mi grada" sube al carril en escritorio (en móvil vive en el flujo).
            -mx-4 neutraliza su padding para alinear con el resto del carril. */}
        {hasFavorites && (
          <div className="-mx-4">
            <MiGrada matches={matches} teamIds={favorites} leagueIds={leagues} todayKey={todayKey} />
          </div>
        )}

        {showUpcoming && upcoming.length > 0 && (
          <section>
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                {t('common.upcoming')}
              </span>
              <span className="text-[11px] font-light text-slate-500 dark:text-slate-400 tabular-nums">
                {upcoming.length}
              </span>
            </div>
            <ul className="space-y-2">
              {upcoming.map((m) => (
                <li key={m.id}>
                  <CompetitionCaption name={m.competitionName} id={m.competitionId} />
                  <MatchCard match={m} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {!hasFavorites && (
          <Link href="/competitions"
                className="card p-4 flex items-center gap-3 transition-colors
                           hover:border-slate-300 dark:hover:border-slate-600">
            <div className="w-10 h-10 rounded-2xl bg-rink-passion/10 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
                   className="w-5 h-5 text-rink-passion">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                      strokeLinejoin="round" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 dark:text-slate-50">{t('favorites.onboarding_title')}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
                {t('favorites.onboarding_cta')} →
              </p>
            </div>
          </Link>
        )}
      </div>
    </aside>
  );
}

/**
 * Banda "En directo ahora" — solo escritorio (en móvil la cubre LiveNowStrip).
 * Destaca los partidos en juego del día con jerarquía de marcador grande;
 * refuerza la promesa visual del producto (si la pantalla está verde, algo está
 * pasando ahora). Los directos se retiran de las listas en todos los breakpoints.
 */
function LiveNowBand({ matches, favorites, className = '', degraded }: {
  matches: Match[];
  favorites: string[];
  className?: string;
  degraded: boolean;
}) {
  const { t } = useT();
  const favSet = useMemo(() => new Set(favorites), [favorites]);

  return (
    <section aria-label={t('common.live_now')} className={`px-4 pt-1 pb-4 ${className}`}>
      <div className="flex items-center gap-2 pb-3">
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-live" />
        </span>
        <h2 className="text-xs font-bold uppercase tracking-widest text-live-deep dark:text-live">
          {t('common.live_now')}
        </h2>
        <span className="text-[11px] font-light text-slate-500 dark:text-slate-400 tabular-nums">
          {matches.length}
        </span>
        {degraded && (
          <span className="text-[11px] font-medium text-rose-500 dark:text-rose-400" role="status" aria-live="polite">
            · {tt(t, 'match_states.live_reconnecting', 'Reconectando…')}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 min-[1700px]:grid-cols-3 min-[2000px]:grid-cols-4">
        {matches.map((m) => (
          <LiveBoard
            key={m.id}
            match={m}
            isFavoriteTeam={favSet.has(m.homeTeamId) || favSet.has(m.awayTeamId)}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Tira "En directo ahora" — solo móvil. La banda de escritorio (LiveNowBand) no
 * se renderiza aquí, así que esta tira compacta y deslizable cubre el "qué se
 * juega ahora" en la grada. Los directos se retiran de las listas en todos los
 * breakpoints para no repetirlos.
 */
function LiveStripCard({ match, isFavoriteTeam }: { match: Match; isFavoriteTeam: boolean }) {
  const { t } = useT();
  const homeName = match.homeTeam?.shortName ?? match.homeTeam?.name ?? match.homeTeamId;
  const awayName = match.awayTeam?.shortName ?? match.awayTeam?.name ?? match.awayTeamId;
  const isHalftime = match.isHalftime === true;
  return (
    <Link
      href={`/matches/${match.id}`}
      aria-label={tt(t, 'a11y.view_match', 'Ver partido: {home} - {away}', { home: homeName, away: awayName })}
      className="card relative flex w-[190px] shrink-0 flex-col gap-1.5 p-2.5 ring-1 ring-live/25
                 hover:shadow-md focus:outline-none focus-visible:ring-2
                 focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent"
    >
      <span className="flex h-4 items-center justify-between gap-1.5">
        {isFavoriteTeam ? (
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-3 w-3 shrink-0 text-rink-passion">
            <path d="M12 2l3.09 6.26L22 9.27l-4.91 4.79 1.16 6.94L12 17.77l-6.25 3.23 1.16-6.94L2 9.27l6.91-1.01L12 2z" />
          </svg>
        ) : (
          <span aria-hidden="true" />
        )}
        {isHalftime ? (
          <span className="inline-flex shrink-0 items-center rounded-full bg-halftime-deep px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
            {t('match_states.half_time')}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-live-deep px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
            <span className="h-1 w-1 rounded-full bg-white animate-pulse" aria-hidden="true" />
            {t('match_states.live')}
          </span>
        )}
      </span>
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <TeamShield teamId={match.homeTeam?.id ?? ''} teamName={match.homeTeam?.name ?? homeName} size={18} className="shrink-0" />
            <span className="truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100">{homeName}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <TeamShield teamId={match.awayTeam?.id ?? ''} teamName={match.awayTeam?.name ?? awayName} size={18} className="shrink-0" />
            <span className="truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100">{awayName}</span>
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 font-score text-base font-extrabold leading-none tracking-tighter tabular-nums text-slate-900 dark:text-slate-50">
          <span>{match.score.home ?? 0}</span>
          <span>{match.score.away ?? 0}</span>
        </span>
      </span>
    </Link>
  );
}

function LiveNowStrip({ matches, favorites, degraded }: { matches: Match[]; favorites: string[]; degraded: boolean }) {
  const { t } = useT();
  const favSet = useMemo(() => new Set(favorites), [favorites]);
  if (matches.length === 0) return null;
  return (
    // El swipe horizontal de la tira no debe cambiar el día: cortamos la
    // propagación de los eventos táctiles hacia el contenedor que hace el swipe.
    <section
      aria-label={t('common.live_now')}
      className="lg:hidden pb-3"
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-4 pt-1 pb-2">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-live" />
        </span>
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-live-deep dark:text-live">
          {t('common.live_now')}
        </h2>
        <span className="text-[11px] font-light text-slate-500 dark:text-slate-400 tabular-nums">{matches.length}</span>
        {degraded && (
          <span className="text-[11px] font-medium text-rose-500 dark:text-rose-400 truncate" role="status" aria-live="polite">
            · {tt(t, 'match_states.live_reconnecting', 'Reconectando…')}
          </span>
        )}
      </div>
      <ul className="flex gap-2 overflow-x-auto scrollbar-none px-4 pb-1">
        {matches.map((m) => (
          <li key={m.id} className="shrink-0">
            <LiveStripCard match={m} isFavoriteTeam={favSet.has(m.homeTeamId) || favSet.has(m.awayTeamId)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface MatchesViewProps {
  matches: Match[];
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  const { t } = useT();
  return (
    <div className="flex items-center justify-between px-4 pt-5 pb-2">
      <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="text-[11px] font-light text-slate-500 dark:text-slate-400 tabular-nums">
        {count} {count === 1 ? t('common.match_lc') : t('common.matches_lc')}
      </span>
    </div>
  );
}

/** Etiqueta de competición sobre un partido (en listas con competiciones mezcladas). */
function CompetitionCaption({ name, id }: { name?: string | null; id?: string | null }) {
  if (!name) return null;
  const className = 'text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1 pb-0.5';
  return id ? (
    <Link href={`/competitions/${id}`} className={`${className} inline-block hover:text-rink-passion transition-colors`}>
      {name}
    </Link>
  ) : (
    <p className={className}>{name}</p>
  );
}

/** Estado vacío de favoritos — onboarding motivador, no una sección en blanco */
function FavoritesOnboarding() {
  const { t } = useT();
  return (
    <div className="mx-4 mt-4 card p-5 flex items-center gap-4">
      <div className="w-12 h-12 rounded-2xl bg-rink-passion/10 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
             className="w-6 h-6 text-rink-passion">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                strokeLinejoin="round" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-900 dark:text-slate-50">{t('favorites.onboarding_title')}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
          {t('favorites.onboarding_body')}
        </p>
        <Link href="/competitions"
              className="inline-block mt-2 text-xs font-semibold text-rink-passion hover:underline">
          {t('favorites.onboarding_cta')} →
        </Link>
      </div>
    </div>
  );
}

/** Fecha "22 de junio de 2026" (capitalizada) en el idioma activo. */
function formatDateHeader(dateKey: string, locale: string): string {
  const s = new Date(`${dateKey}T12:00:00`).toLocaleDateString(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Estado vacío de la home: mensaje claro ("No hay partidos para hoy") y, debajo,
 * los PRÓXIMOS partidos agrupados por día y DENTRO de cada día por competición
 * (#414: la lista plana con etiquetas flotantes se leía como una sopa de filas
 * estiradas). Mismo lenguaje de secciones que la jornada de la portada.
 */
function UpcomingMatches({ matches, selectedDate, todayKey, outOfWindow = false }: {
  matches: Match[];
  selectedDate: string;
  todayKey: string;
  outOfWindow?: boolean;
}) {
  const { t, locale } = useT();
  const isToday = selectedDate === todayKey;
  // En días anteriores a hoy NO mostramos "próximos": ver partidos/resultados
  // posteriores a un día ya pasado confunde. Solo el mensaje de "no hay partidos".
  const isPast = selectedDate < todayKey;

  const groups = useMemo(
    () => groupUpcomingByDay(matches, selectedDate, locale),
    [matches, selectedDate, locale],
  );
  const visibleGroups = isPast ? [] : groups;

  return (
    <div>
      <div className={`flex flex-col items-center text-center pt-8 px-8 gap-1 ${isPast ? 'pb-12' : 'pb-2'}`}>
        <EmptyRinkScene />
        <p className="text-base font-bold text-slate-800 dark:text-slate-100">
          {outOfWindow
            ? t('common.day_out_of_window')
            : isToday ? t('common.no_matches_today') : t('common.no_matches_this_day')}
        </p>
        {!isPast && !outOfWindow && visibleGroups.length > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('common.upcoming_intro')}</p>
        )}
      </div>

      {isPast ? null : visibleGroups.length === 0 ? (
        <p className="text-center text-xs text-slate-500 dark:text-slate-400 px-8 pb-12">
          {t('common.no_upcoming')}
        </p>
      ) : (
        /*
          Banda por día a todo el ancho: cabecera con hairline + competiciones
          del día en masonry horizontal (misma mecánica que la jornada). Así el
          ancho siempre se usa — un día de 1 partido es una banda corta, no una
          columna huérfana flotando en blanco (#414).
        */
        <div className="pb-6">
          {visibleGroups.map((day) => (
            <section key={day.dateKey} className="min-w-0">
              <div className="mx-4 flex items-baseline justify-between border-b border-slate-100
                              pt-5 pb-2 dark:border-slate-800">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-50">
                  {formatDateHeader(day.dateKey, locale)}
                </h2>
                <span className="text-[11px] font-light text-slate-500 dark:text-slate-400 tabular-nums shrink-0 ml-3">
                  {day.total} {day.total === 1 ? t('common.match_lc') : t('common.matches_lc')}
                </span>
              </div>
              <div className="px-4 pt-3 pb-1 columns-1 md:columns-2 gap-5
                              min-[1500px]:columns-3 min-[2000px]:columns-4">
                {day.competitions.map((comp) => (
                  <UpcomingGroup
                    key={comp.id ?? comp.name ?? 'other'}
                    name={comp.name}
                    id={comp.id}
                    matches={comp.matches}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * #346: estado de error de carga de la home. Antes era un bloque inline sin
 * botón de reintento y con copy fijo en español (para las 5 locales). Ahora el
 * mensaje sale del i18n del locale activo y `router.refresh()` revalida el
 * Server Component, que vuelve a llamar a la API (reintento real).
 */
export function HomeLoadError() {
  const { t } = useT();
  const router = useRouter();

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
        {tt(t, 'errors.matches_load_title', 'No hemos podido cargar los partidos')}
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

export function MatchesView({ matches: initialMatches }: MatchesViewProps) {
  // Refresco en vivo: mientras haya partidos en juego, la lista se sincroniza con
  // el resultado real sondeando /current sin caché (la home es SSR y, si no, el
  // marcador quedaría congelado frente al detalle, que sí va por SSE).
  const { matches, degraded } = useLiveScores(initialMatches);

  // "Hoy" anclado en Europe/Madrid: misma autoridad horaria que usa el filtrado
  // de partidos. Estable en SSR (servidor UTC) y en cualquier TZ del dispositivo.
  const todayKey = madridTodayKey();
  const [selectedDate, setSelectedDateState] = useState<string>(todayKey);

  // El día elegido sobrevive al pull-to-refresh (sessionStorage: muere al
  // cerrar la pestaña, así mañana la app vuelve a abrir en "hoy").
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('rink-selected-date');
      if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) {
        if (Math.abs(dayDiff(saved, todayKey)) <= 7) setSelectedDateState(saved);
      }
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSelectedDate = useCallback((key: string) => {
    setSelectedDateState(key);
    try { sessionStorage.setItem('rink-selected-date', key); } catch { /* noop */ }
  }, []);
  const [showAllFavs, setShowAllFavs] = useState(false);
  const { favorites, leagues, isFavorite } = useFavorites();
  const { t, locale } = useT();

  // ── Swipe horizontal: día anterior / siguiente ─────────────────────────────
  const shiftDay = (delta: number) => {
    const next = addDaysToKey(selectedDate, delta);
    // Mantenerse dentro de la ventana del DateSelector (hoy ± 7 días)
    if (Math.abs(dayDiff(next, todayKey)) > 7) return;
    setSelectedDate(next);
  };

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t0 = e.touches[0];
    if (t0) touchStart.current = { x: t0.clientX, y: t0.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const t0 = e.changedTouches[0];
    if (!start || !t0) return;
    const dx = t0.clientX - start.x;
    const dy = t0.clientY - start.y;
    // Gesto claramente horizontal: 60px mínimo y el doble que el desplazamiento vertical
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return;
    shiftDay(dx < 0 ? 1 : -1); // izquierda = siguiente día (como pasar página)
  };

  // Filtrar por fecha seleccionada
  const dayMatches = useMemo(
    () => matches.filter((m) => madridDateKey(m.scheduledAt) === selectedDate),
    [matches, selectedDate]
  );

  // Separar favoritos del resto. Los directos se excluyen aquí: viven en la
  // banda (escritorio) o en la tira (móvil), nunca duplicados en las listas.
  const { favMatches, restMatches } = useMemo(() => {
    const notLive = (m: Match) => m.status !== 'live';
    if (favorites.length === 0) {
      return { favMatches: [] as Match[], restMatches: dayMatches.filter(notLive) };
    }
    const fav: Match[] = [];
    const rest: Match[] = [];
    for (const m of dayMatches) {
      if (!notLive(m)) continue;
      if (isFavorite(m.homeTeamId) || isFavorite(m.awayTeamId)) {
        fav.push(m);
      } else {
        rest.push(m);
      }
    }
    return { favMatches: fav, restMatches: rest };
  }, [dayMatches, favorites, isFavorite]);

  // Los no-favoritos se agrupan POR COMPETICIÓN (antes había una cabecera fija
  // "OK Liga Masculina" que etiquetaba mal los partidos de otras competiciones)
  // y los bloques se ordenan por IMPORTANCIA, el mismo criterio que el listado
  // de competiciones. Una competición sin partidos ese día no tiene bloque.
  const restByCompetition = useMemo(() => {
    const map = new Map<string, Match[]>();
    for (const m of restMatches) {
      const key = m.competitionName ?? tt(t, 'common.other_competitions', 'Otras competiciones');
      const arr = map.get(key);
      if (arr) arr.push(m); else map.set(key, [m]);
    }
    return [...map.entries()].sort(([aName, aMs], [bName, bMs]) => {
      const d = importanceRank(aMs[0]?.competitionSlug) - importanceRank(bMs[0]?.competitionSlug);
      return d !== 0 ? d : aName.localeCompare(bName, locale);
    });
  }, [restMatches, locale, t]);

  const hasBothSections = favMatches.length > 0 && restMatches.length > 0;

  // Partidos en directo del día seleccionado: se destacan en la banda
  // (escritorio) o en la tira (móvil) y se retiran de las listas en todos los
  // breakpoints para no repetirlos.
  const liveMatches = useMemo(
    () => dayMatches.filter((m) => m.status === 'live').sort((a, b) => timeOf(a) - timeOf(b)),
    [dayMatches]
  );

  // Banner in-list "entre resultados": posición sobre la lista del día (no
  // favoritos) y sección tras la que cae. -1 si no procede (pocos partidos).
  const adIndex = useMemo(
    () => listAdInsertIndex(restMatches.length, ADS.listEvery),
    [restMatches.length],
  );
  const adSectionIndex = useMemo(() => {
    if (adIndex < 0) return -1;
    let cumulative = 0;
    for (let i = 0; i < restByCompetition.length; i++) {
      const group = restByCompetition[i];
      if (!group) continue;
      cumulative += group[1].length;
      if (cumulative >= adIndex) return i;
    }
    return -1;
  }, [restByCompetition, adIndex]);

  // Rango de días con datos cargados (#365): acota el DateSelector para no
  // ofrecer días que la ventana del API no cubre y que saldrían vacíos.
  const windowRange = useMemo(() => {
    let from: string | null = null;
    let to: string | null = null;
    for (const m of matches) {
      const k = madridDateKey(m.scheduledAt);
      if (!k) continue;
      if (from === null || k < from) from = k;
      if (to === null || k > to) to = k;
    }
    return { from, to };
  }, [matches]);
  const outOfWindow = (!!windowRange.from && selectedDate < windowRange.from)
    || (!!windowRange.to && selectedDate > windowRange.to);

  // #361: región viva que anuncia goles/estado del directo, sin spamear.
  const prevMatchesRef = useRef<Match[] | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  useEffect(() => {
    const prev = prevMatchesRef.current;
    prevMatchesRef.current = matches;
    if (prev === null) return; // primer render: no anunciamos
    const changes = diffLiveScores(prev, matches).slice(0, 3);
    if (changes.length === 0) return;
    setLiveAnnouncement(changes.map((c) => {
      const vars = { home: c.homeName, away: c.awayName, h: c.home, a: c.away };
      if (c.kind === 'goal')  return tt(t, 'a11y.live_goal', 'Gol: {home} {h}-{a} {away}', vars);
      if (c.kind === 'start') return tt(t, 'a11y.live_start', 'Empieza {home} - {away}', vars);
      return tt(t, 'a11y.live_end', 'Final: {home} {h}-{a} {away}', vars);
    }).join(' · '));
  }, [matches, t]);

  return (
    <div data-wide className="flex flex-col min-h-screen lg:mx-auto lg:w-full lg:max-w-[2200px]">
      {/* Encabezado principal de la home (oculto visualmente, para lectores y SEO) */}
      <h1 className="sr-only">{t('a11y.home_heading')}</h1>

      {/* #361: anuncio de cambios del directo (polite, atómico). */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnouncement}
      </div>

      {/* Selector de fecha — sticky bajo el header */}
      <div className="sticky top-0 z-30">
        <DateSelector
          selected={selectedDate}
          onChange={setSelectedDate}
          availableFrom={windowRange.from}
          availableTo={windowRange.to}
        />
      </div>

      {/*
        Banner home-top: justo bajo el DateSelector sticky.
        Al ser un cliente Premium, AdBanner devuelve null y el layout
        se estira limpiamente sin hueco.
        z-index inferior al DateSelector para no taparlo al hacer scroll.
      */}
      <AdBanner zone="home-top" className="z-20" />

      {/*
        Composición de escritorio (lg+): barra de fecha → banda "En directo
        ahora" → jornada en rejilla por competición → carril de contexto.
        El móvil conserva su columna única: la misma estructura, sin rejilla.
      */}
      <div className="w-full flex-1 lg:px-6 lg:pt-4 lg:pb-10">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)] lg:items-start lg:gap-6
                        2xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {/* #263 "Mi grada": feed agregado de equipos/ligas seguidos (próximos +
            últimos), independiente del día seleccionado. En móvil va en el
            flujo; en escritorio sube al carril de contexto. */}
        {/* Tira EN DIRECTO — solo móvil (en escritorio manda la banda) */}
        <LiveNowStrip matches={liveMatches} favorites={favorites} degraded={degraded} />

        <div className="lg:hidden">
          <MiGrada matches={matches} teamIds={favorites} leagueIds={leagues} todayKey={todayKey} />
        </div>

        {/* Banda EN DIRECTO — solo escritorio */}
        {liveMatches.length > 0 && (
          <LiveNowBand matches={liveMatches} favorites={favorites} className="hidden lg:block" degraded={degraded} />
        )}

        {dayMatches.length === 0 ? (
          <UpcomingMatches
            matches={matches}
            selectedDate={selectedDate}
            todayKey={todayKey}
            outOfWindow={outOfWindow}
          />
        ) : (
          <>
            {/* Onboarding de favoritos: solo si el usuario no sigue a nadie */}
            {favorites.length === 0 && <FavoritesOnboarding />}

            {/* Bloque "Siguiendo" — tus equipos de hoy. Los directos viven en
                la banda/tira, no aquí. */}
            {favMatches.length > 0 && (
              <section>
                <div className="flex items-center justify-between pr-4">
                  <SectionHeader label={`⭐ ${t('favorites.following_section')}`} count={favMatches.length} />
                  <Link href="/favorites"
                        className="text-[11px] font-semibold text-rink-passion hover:underline shrink-0 min-h-[44px] inline-flex items-center">
                    {t('favorites.manage')}
                  </Link>
                </div>
                <ul className="px-4 grid grid-cols-1 gap-2 xl:grid-cols-2 xl:gap-x-6 min-[1800px]:grid-cols-3">
                  {(showAllFavs ? favMatches : favMatches.slice(0, FAV_PREVIEW)).map((m) => (
                    <li key={m.id}>
                      <CompetitionCaption name={m.competitionName} id={m.competitionId} />
                      <MatchCard match={m} isFavoriteTeam />
                    </li>
                  ))}
                </ul>
                {favMatches.length > FAV_PREVIEW && (
                  <button
                    onClick={() => setShowAllFavs((v) => !v)}
                    className="mx-4 mt-2 w-[calc(100%-2rem)] py-2.5 min-h-[44px] text-xs font-semibold
                               text-rink-passion rounded-xl border border-slate-200 dark:border-slate-800
                               hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                  >
                    {showAllFavs
                      ? t('favorites.show_less')
                      : t('favorites.show_other_matches', { n: favMatches.length - FAV_PREVIEW })}
                  </button>
                )}
              </section>
            )}

            {/*
              Banner home-inline: se inyecta entre la sección de favoritos y la
              sección principal de partidos, solo cuando ambas existen.
              Para usuarios Free aparece como tarjeta nativa (FotMob-style).
              Para usuarios Premium: null, ambas secciones se unen sin separación.
            */}
            {hasBothSections && (
              <AdBanner zone="home-inline" className="my-1" />
            )}

            {/* Bloque principal — una sección por competición. En pantallas
                anchas se reparte en 2–3 columnas equilibradas (masonry CSS)
                para que toda la jornada entre sin huecos ni scroll. */}
            <div className="xl:columns-2 xl:gap-6 min-[1800px]:columns-3">
              {restByCompetition.map(([comp, ms], i) => (
                <Fragment key={comp}>
                  <section className="break-inside-avoid">
                    <SectionHeader label={comp} count={ms.length} />
                    <ul className="px-4 space-y-2 pb-4">
                      {ms.map((m) => (
                        <li key={m.id}>
                          <MatchCard match={m} />
                        </li>
                      ))}
                    </ul>
                  </section>
                  {/* Banner entre resultados (solo si hay suficientes partidos).
                      Si AdBanner no procede (Premium/sin config) no deja hueco. */}
                  {i === adSectionIndex && (
                    <AdBanner zone="list-inline" className="my-2 break-inside-avoid" />
                  )}
                </Fragment>
              ))}
            </div>
          </>
        )}
          </div>

          {/* Carril de contexto — solo en pantallas muy anchas. Sin la sección
              "Próximos" cuando la vista principal ya muestra los próximos
              (día vacío): serían las mismas tarjetas dos veces (#414). */}
          <DesktopAside
            className="hidden 2xl:block"
            matches={matches}
            hasFavorites={favorites.length > 0}
            favorites={favorites}
            leagues={leagues}
            todayKey={todayKey}
            selectedDate={selectedDate}
            showUpcoming={dayMatches.length > 0}
          />
        </div>
      </div>
    </div>
  );
}
