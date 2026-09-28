'use client';

import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react';
import type { Match } from '@/lib/api/client';
import { useFavorites } from '@/hooks/useFavorites';
import { useLiveScores } from '@/hooks/useLiveScores';
import { DateSelector } from '@/components/shared/DateSelector';
import { MatchCard } from '@/components/shared/MatchCard';
import { MiGrada } from '@/components/home/MiGrada';
import { AdBanner } from '@/components/shared/AdBanner';
import { adsenseConfig, listAdInsertIndex } from '@/lib/ads';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { madridDateKey, madridTodayKey, addDaysToKey, dayDiff } from '@/lib/match-time';
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
 * Escena del estado vacío: la bola cruza la pista, gol y celebración.
 * Reutiliza los @keyframes rink* de globals.css (respetan reduce-motion).
 * Decorativa: aria-hidden.
 */
function EmptyRinkScene() {
  const anim = (name: string) => ({ animation: `${name} 3s ease-in-out infinite` });
  return (
    <div aria-hidden="true" className="relative mx-auto mb-1 h-[72px] w-[200px] select-none">
      {/* Línea de pista */}
      <span className="absolute left-0 right-0 bottom-3 h-px bg-slate-200 dark:bg-slate-700" />
      {/* Portería / red a la derecha */}
      <svg viewBox="0 0 24 24" className="rink-empty-anim absolute bottom-2 right-1 w-8 h-10 text-slate-300 dark:text-slate-600"
           style={anim('rinkNet')} fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M4 4h16v14H4z" />
        <path d="M4 8h16M4 12h16M8 4v14M12 4v14M16 4v14" strokeWidth={0.5} />
      </svg>
      {/* Stick */}
      <svg viewBox="0 0 24 24" className="rink-empty-anim absolute bottom-2 left-2 w-6 h-8 text-slate-500 dark:text-slate-400"
           style={{ ...anim('rinkStick'), transformOrigin: 'bottom center' }}
           fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v14M12 16c-2 0-4 1-5 3" />
      </svg>
      {/* Bola */}
      <span className="rink-empty-anim absolute bottom-[10px] left-[26px] w-2.5 h-2.5 rounded-full bg-rink-passion"
            style={anim('rinkShot')} />
      {/* Destello de gol */}
      <svg viewBox="0 0 24 24" className="rink-empty-anim absolute bottom-4 right-3 w-6 h-6 text-emerald-500"
           style={anim('rinkGoalFlash')} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M18.4 5.6l-2 2M7.6 16.4l-2 2" />
      </svg>
    </div>
  );
}

/**
 * Carril de contexto en escritorio (lg+): próximos partidos y, si no sigues a
 * nadie, una llamada a explorar competiciones. Reutiliza datos ya calculados,
 * sin peticiones nuevas. Oculto en móvil.
 */
function DesktopAside({ matches, hasFavorites }: { matches: Match[]; hasFavorites: boolean }) {
  const { t } = useT();
  const upcoming = useMemo(() => {
    const now = Date.now();
    return matches
      .filter((m) => m.scheduledAt && new Date(m.scheduledAt).getTime() > now)
      .sort((a, b) => ((a.scheduledAt ?? '') < (b.scheduledAt ?? '') ? -1 : 1))
      .slice(0, 4);
  }, [matches]);

  return (
    <aside className="hidden lg:block lg:w-80 lg:shrink-0 lg:py-4">
      <div className="sticky top-4 flex flex-col gap-4">
        {upcoming.length > 0 && (
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
 * los PRÓXIMOS partidos agrupados por fecha (ascendente), con el mismo diseño de
 * MatchCard. Evita pantallas vacías y resultados antiguos.
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

  const groups = useMemo(() => {
    if (isPast) return [] as Array<[string, Match[]]>;
    const upcoming = matches
      .map((m) => ({ m, key: madridDateKey(m.scheduledAt) }))
      .filter((x): x is { m: Match; key: string } => !!x.key && x.key > selectedDate)
      .sort((a, b) =>
        a.key !== b.key
          ? (a.key < b.key ? -1 : 1)
          : ((a.m.scheduledAt ?? '') < (b.m.scheduledAt ?? '') ? -1 : 1)
      );
    const byDate = new Map<string, Match[]>();
    for (const { m, key } of upcoming) {
      const arr = byDate.get(key);
      if (arr) arr.push(m); else byDate.set(key, [m]);
    }
    return Array.from(byDate.entries()); // ya ascendente por orden de inserción
  }, [matches, selectedDate, isPast]);

  return (
    <div>
      <div className={`flex flex-col items-center text-center pt-10 px-8 gap-1 ${isPast ? 'pb-12' : 'pb-4'}`}>
        <EmptyRinkScene />
        <p className="text-base font-bold text-slate-800 dark:text-slate-100">
          {outOfWindow
            ? t('common.day_out_of_window')
            : isToday ? t('common.no_matches_today') : t('common.no_matches_this_day')}
        </p>
        {!isPast && !outOfWindow && groups.length > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('common.upcoming_intro')}</p>
        )}
      </div>

      {isPast ? null : groups.length === 0 ? (
        <p className="text-center text-xs text-slate-500 dark:text-slate-400 px-8 pb-12">
          {t('common.no_upcoming')}
        </p>
      ) : (
        groups.map(([dateKey, ms]) => (
          <section key={dateKey}>
            <SectionHeader label={formatDateHeader(dateKey, locale)} count={ms.length} />
            <ul className="px-4 space-y-2 pb-2">
              {ms.map((m) => (
                <li key={m.id}>
                  <CompetitionCaption name={m.competitionName} id={m.competitionId} />
                  <MatchCard match={m} />
                </li>
              ))}
            </ul>
          </section>
        ))
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
                   bg-rink-passion hover:bg-red-700 active:bg-red-900
                   text-white font-semibold text-sm
                   px-5 py-2.5 rounded-xl transition-colors
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion focus-visible:ring-offset-2"
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
  const matches = useLiveScores(initialMatches);

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

  // Separar favoritos del resto
  const { favMatches, restMatches } = useMemo(() => {
    if (favorites.length === 0) {
      return { favMatches: [] as Match[], restMatches: dayMatches };
    }
    const fav: Match[] = [];
    const rest: Match[] = [];
    for (const m of dayMatches) {
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
      const key = m.competitionName ?? 'Otras competiciones';
      const arr = map.get(key);
      if (arr) arr.push(m); else map.set(key, [m]);
    }
    return [...map.entries()].sort(([aName, aMs], [bName, bMs]) => {
      const d = importanceRank(aMs[0]?.competitionSlug) - importanceRank(bMs[0]?.competitionSlug);
      return d !== 0 ? d : aName.localeCompare(bName, locale);
    });
  }, [restMatches, locale]);

  const hasBothSections = favMatches.length > 0 && restMatches.length > 0;

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
    <div className="flex flex-col min-h-screen">
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

      {/* Lista de partidos — swipe horizontal para cambiar de día. En escritorio,
          carril de contexto (próximos + favoritos) a la derecha. */}
      <div className="flex-1 lg:flex lg:justify-center lg:gap-6 lg:px-6">
        <div className="w-full lg:max-w-2xl" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {/* #263 "Mi grada": feed agregado de equipos/ligas seguidos (próximos +
            últimos), independiente del día seleccionado. Móvil y escritorio. */}
        <MiGrada matches={matches} teamIds={favorites} leagueIds={leagues} todayKey={todayKey} />

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

            {/* Bloque "Siguiendo" — favoritos arriba, sin sepultar el día */}
            {favMatches.length > 0 && (
              <section>
                <div className="flex items-center justify-between pr-4">
                  <SectionHeader label={`⭐ ${t('favorites.following_section')}`} count={favMatches.length} />
                  <Link href="/favorites"
                        className="text-[11px] font-semibold text-rink-passion hover:underline shrink-0 min-h-[44px] inline-flex items-center">
                    {t('favorites.manage')}
                  </Link>
                </div>
                <ul className="px-4 space-y-2">
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

            {/* Bloque principal — una sección por competición */}
            {restByCompetition.map(([comp, ms], i) => (
              <Fragment key={comp}>
                <section>
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
                {i === adSectionIndex && <AdBanner zone="list-inline" className="my-2" />}
              </Fragment>
            ))}
          </>
        )}
        </div>
        <DesktopAside matches={matches} hasFavorites={favorites.length > 0} />
      </div>
    </div>
  );
}
