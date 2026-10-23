'use client';

import { useState, useMemo, useRef, useEffect, useCallback, Fragment, type ReactNode } from 'react';
import type { Match } from '@/lib/api/client';
import { useFavorites } from '@/hooks/useFavorites';
import { useLiveScores } from '@/hooks/useLiveScores';
import { DateSelector } from '@/components/shared/DateSelector';
import { MiGrada } from '@/components/home/MiGrada';
import { MatchRow } from '@/components/home/MatchRow';
import { MatchGroupCard, CompetitionIcon, FollowStar } from '@/components/home/MatchGroupCard';
import { DayChips } from '@/components/home/DayChips';
import { AdBanner } from '@/components/shared/AdBanner';
import { adsenseConfig, listAdInsertIndex } from '@/lib/ads';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import { madridDateKey, madridTodayKey, addDaysToKey, dayDiff } from '@/lib/match-time';
import { buildDayView, nextMatchday, daysWithMatches, type DayFilter, type DayView } from '@/lib/day-view';
import { tt } from '@/components/search/translate';
import { clubName } from '@/lib/names';
import { competitionPath } from '@/lib/competition-path';

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
 * Escena del estado vacío — "una jugada, una vez": la bola entra en la portería
 * UNA sola vez al montar (la red vibra y se enciende el esmeralda ~300 ms) y la
 * escena queda en calma. Reutiliza los @keyframes rink* de globals.css, que
 * respetan reduce-motion (dejan la escena estática). Decorativa: aria-hidden.
 */
function EmptyRinkScene() {
  // `both` fija el fotograma final para que la animación no "vuelva" al inicio.
  const once = (name: string, duration: string, ease = 'ease-out') => ({
    animation: `${name} ${duration} ${ease} both`,
  });
  return (
    <div aria-hidden="true" className="relative mx-auto mb-2 h-20 w-64 select-none">
      <span
        className="rink-empty-anim absolute inset-x-4 bottom-6 h-px origin-left bg-slate-300 dark:bg-slate-600"
        style={once('rinkDraw', '0.9s')}
      />
      <svg viewBox="0 0 54 40"
           className="rink-empty-anim absolute bottom-6 right-3 h-10 w-14 text-slate-500 dark:text-slate-400"
           style={once('rinkNetHit', '1.8s')}
           fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
        <path d="M2 2v36M52 2v36M2 2h50" />
        <path d="M2 14h50M2 26h50" strokeWidth={0.5} />
        <path d="M18 2v36M36 2v36" strokeWidth={0.5} />
      </svg>
      <span
        className="rink-empty-anim absolute bottom-6 left-10 h-3 w-3 rounded-full bg-rink-passion shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
        style={once('rinkBall', '1.8s', 'cubic-bezier(0.16,1,0.3,1)')}
      />
      <svg viewBox="0 0 24 24"
           className="rink-empty-anim absolute bottom-12 right-8 h-5 w-5 text-emerald-500 opacity-0"
           style={once('rinkFlash', '1.8s')}
           fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l1.8 1.8M16.2 16.2L18 18M18 6l-1.8 1.8M7.8 16.2L6 18" />
      </svg>
    </div>
  );
}

/** Estrella de onboarding (contorno). */
function OnboardingIcon() {
  return (
    <div className="w-10 h-10 rounded-2xl bg-rink-passion/10 flex items-center justify-center shrink-0">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
           className="w-5 h-5 text-rink-passion" aria-hidden="true">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
              strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/**
 * Carril de contexto en escritorio muy ancho (2xl+): "Mi grada" si sigues a
 * alguien (próximos y últimos resultados, con fecha) o una llamada a explorar
 * competiciones si no. Sin "Próximos": el día vacío ya los muestra.
 */
function DesktopAside({ matches, favorites, leagues, todayKey, className = '' }: {
  matches: Match[];
  favorites: string[];
  leagues: string[];
  todayKey: string;
  className?: string;
}) {
  const { t } = useT();
  const follows = favorites.length > 0 || leagues.length > 0;
  return (
    <aside className={`shrink-0 ${className}`}>
      <div className="rail-scroll sticky top-[76px] flex max-h-[calc(100vh-92px)] flex-col gap-4 overflow-y-auto pb-1">
        {follows ? (
          <MiGrada matches={matches} teamIds={favorites} leagueIds={leagues} todayKey={todayKey} />
        ) : (
          <Link href="/competitions"
                className="card p-4 flex items-center gap-3 transition-colors
                           hover:border-slate-300 dark:hover:border-slate-600">
            <OnboardingIcon />
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

/** Onboarding de favoritos: motivador, nunca antes de los partidos. */
function FavoritesOnboarding({ className = '' }: { className?: string }) {
  const { t } = useT();
  return (
    <div className={`card flex items-center gap-3 px-3 py-2.5 ${className}`}>
      <OnboardingIcon />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold text-slate-900 dark:text-slate-50">{t('favorites.onboarding_title')}</p>
        <p className="mt-0.5 text-xs leading-snug text-slate-500 dark:text-slate-400">
          {t('favorites.onboarding_body')}
        </p>
        <Link href="/competitions"
              className="inline-flex min-h-[36px] items-center text-xs font-semibold text-rink-passion hover:underline dark:text-rink-accent">
          {t('favorites.onboarding_cta')} →
        </Link>
      </div>
    </div>
  );
}

/** "miércoles 21 de octubre" en el idioma activo, sin comas. */
function longDayLabel(dateKey: string, locale: string, withMonth: boolean): string {
  const s = new Date(`${dateKey}T12:00:00`).toLocaleDateString(locale, withMonth
    ? { weekday: 'long', day: 'numeric', month: 'long' }
    : { weekday: 'long', day: 'numeric' });
  return s.replace(/,/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Las tarjetas de una jornada: "Siguiendo" (tus equipos) y una por competición.
 * `afterFirst` se intercala tras la primera tarjeta (publicidad y onboarding:
 * nunca antes del primer partido). `listAd` inserta el banner entre resultados.
 */
function DayCards({ view, followedTeamIds, showDate = false, afterFirst, listAd = false }: {
  view: DayView<Match>;
  followedTeamIds: ReadonlySet<string>;
  showDate?: boolean;
  afterFirst?: ReactNode;
  listAd?: boolean;
}) {
  const { t } = useT();
  const other = tt(t, 'common.other_competitions', 'Otras competiciones');

  const cards: { key: string; rows: number; node: ReactNode }[] = [];
  if (view.myTeams.length > 0) {
    cards.push({
      key: '__following__',
      rows: view.myTeams.length,
      node: (
        <MatchGroupCard
          title={t('favorites.following_section')}
          icon={<span className="flex h-5 w-5 items-center justify-center"><FollowStar /></span>}
          count={view.myTeams.length}
          action={
            <Link href="/favorites"
                  className="shrink-0 px-1 py-2 text-[11px] font-semibold text-rink-passion hover:underline dark:text-rink-accent">
              {t('favorites.manage')}
            </Link>
          }
        >
          {view.myTeams.map((m) => (
            <MatchRow key={m.id} match={m} followedTeamIds={followedTeamIds} showDate={showDate}
                      caption={m.competitionName ? clubName(m.competitionName) : null} />
          ))}
        </MatchGroupCard>
      ),
    });
  }
  for (const block of view.competitions) {
    cards.push({
      key: block.key || '__other__',
      rows: block.matches.length,
      node: (
        <MatchGroupCard
          title={block.name ? clubName(block.name) : other}
          href={block.id ? competitionPath(block.id, block.slug) : null}
          icon={<CompetitionIcon country={block.country} name={block.name} />}
          count={block.matches.length}
          followed={block.followed}
        >
          {block.matches.map((m) => (
            <MatchRow key={m.id} match={m} followedTeamIds={followedTeamIds} showDate={showDate} />
          ))}
        </MatchGroupCard>
      ),
    });
  }

  // Banner entre resultados: tras la tarjeta en la que se cruza el umbral de
  // filas. Nunca tras la primera (ahí ya va home-top) ni tras la última.
  let adAfter = -1;
  if (listAd) {
    const adIndex = listAdInsertIndex(cards.reduce((n, c) => n + c.rows, 0), ADS.listEvery);
    if (adIndex >= 0) {
      let cumulative = 0;
      for (let i = 0; i < cards.length; i++) {
        cumulative += cards[i]!.rows;
        if (cumulative >= adIndex) { adAfter = Math.max(i, 1); break; }
      }
      if (adAfter >= cards.length - 1) adAfter = -1;
    }
  }

  return (
    <div className="space-y-3">
      {cards.map((c, i) => (
        <Fragment key={c.key}>
          {c.node}
          {i === 0 && afterFirst}
          {i === adAfter && <AdBanner zone="list-inline" />}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Día sin partidos: mensaje claro y, si el día es hoy o futuro, SOLO la
 * próxima jornada agrupada por competición (desplegada, con fecha en cada
 * fila) y un botón para ir a ese día.
 */
function EmptyDay({ isToday, isPast, outOfWindow, next, followedTeamIds, onGoTo }: {
  isToday: boolean;
  isPast: boolean;
  outOfWindow: boolean;
  next: DayView<Match> | null;
  followedTeamIds: ReadonlySet<string>;
  onGoTo: (dayKey: string) => void;
}) {
  const { t, locale } = useT();
  const message = outOfWindow
    ? t('common.day_out_of_window')
    : isToday ? t('common.no_matches_today')
    : isPast ? tt(t, 'home.no_matches_past', 'No hubo partidos este día')
    : t('common.no_matches_this_day');

  return (
    <div>
      <div className="flex flex-col items-center gap-1 px-6 pb-5 text-center">
        <EmptyRinkScene />
        <p className="text-base font-bold text-slate-800 dark:text-slate-100">{message}</p>
      </div>

      {!isPast && !outOfWindow && (next ? (
        <section aria-labelledby="next-matchday">
          <h2 id="next-matchday" className="px-1 pb-2 text-sm font-bold text-slate-900 dark:text-slate-50">
            {tt(t, 'home.next_matchday', 'Próxima jornada: {day}', { day: longDayLabel(next.dayKey, locale, true) })}
          </h2>
          <DayCards view={next} followedTeamIds={followedTeamIds} showDate />
          <button
            type="button"
            onClick={() => onGoTo(next.dayKey)}
            className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200
                       bg-white text-sm font-semibold text-rink-passion transition-colors hover:bg-slate-50
                       dark:border-slate-700 dark:bg-slate-900 dark:text-rink-accent dark:hover:bg-slate-800
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent"
          >
            {tt(t, 'home.go_to_day', 'Ver el {day}', { day: longDayLabel(next.dayKey, locale, false) })}
            <span aria-hidden="true">→</span>
          </button>
        </section>
      ) : (
        <p className="px-6 pb-10 text-center text-xs text-slate-500 dark:text-slate-400">
          {t('common.no_upcoming')}{' · '}
          <Link href="/competitions" className="font-semibold text-rink-passion hover:underline dark:text-rink-accent">
            {t('favorites.onboarding_cta')}
          </Link>
        </p>
      ))}
    </div>
  );
}

/**
 * #346: estado de error de carga de la home. El mensaje sale del i18n del
 * locale activo y `router.refresh()` revalida el Server Component, que vuelve
 * a llamar a la API (reintento real).
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

interface MatchesViewProps {
  matches: Match[];
}

/**
 * Home (spec 2026-10-16, referencia FotMob): la jornada del día elegido en una
 * tarjeta por competición, con "Siguiendo" arriba y filtros En directo /
 * Siguiendo. Un día vacío enseña la próxima jornada. Lo personal que no es del
 * día (Mi grada) vive en Favoritos y en el carril de escritorio.
 */
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

  // El filtro pertenece al día en que se eligió: al cambiar de día vuelve a
  // "todos" sin efectos ni renders extra.
  const [filterState, setFilterState] = useState<{ day: string; filter: DayFilter }>({ day: todayKey, filter: 'all' });
  const requestedFilter: DayFilter = filterState.day === selectedDate ? filterState.filter : 'all';
  const onFilterChange = useCallback((filter: DayFilter) => {
    setFilterState({ day: selectedDate, filter });
    track('home_filter_changed', { filter });
  }, [selectedDate]);

  const { favorites, leagues } = useFavorites();
  const followedTeamIds = useMemo(() => new Set(favorites), [favorites]);
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

  const view = useMemo(
    () => buildDayView(matches, { dayKey: selectedDate, teamIds: favorites, leagueIds: leagues, filter: requestedFilter, locale }),
    [matches, selectedDate, favorites, leagues, requestedFilter, locale],
  );
  const isPast = selectedDate < todayKey;
  const next = useMemo(
    () => (view.total === 0 && !isPast
      ? nextMatchday(matches, selectedDate, { teamIds: favorites, leagueIds: leagues, locale })
      : null),
    [view.total, isPast, matches, selectedDate, favorites, leagues, locale],
  );
  const markedDays = useMemo(() => daysWithMatches(matches), [matches]);

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
    // Hoy siempre está dentro: si todos los partidos cargados son futuros (o
    // pasados), los días entre hoy y ellos son días vacíos de verdad, no días
    // fuera de la ventana (si no, "hoy" salía bloqueado en el selector y el día
    // vacío no podía enseñar la próxima jornada).
    if (from !== null && from > todayKey) from = todayKey;
    if (to !== null && to < todayKey) to = todayKey;
    return { from, to };
  }, [matches, todayKey]);
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

  const followsSomething = favorites.length > 0 || leagues.length > 0;

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
          markedDays={markedDays}
        />
      </div>

      <div className="w-full flex-1 px-3 pt-3 pb-10 sm:px-4 lg:px-6 lg:pt-5">
        <div className="mx-auto grid max-w-[760px] items-start gap-6
                        2xl:max-w-[1150px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {/* Contexto para lectores de pantalla: de qué día son las tarjetas
                (cada tarjeta es un h3). */}
            <h2 className="sr-only">{longDayLabel(selectedDate, locale, true)}</h2>
            <DayChips
              liveCount={view.liveCount}
              followingCount={view.followingCount}
              filter={view.filter}
              onChange={onFilterChange}
              degraded={degraded}
            />

            {view.total === 0 ? (
              <EmptyDay
                isToday={selectedDate === todayKey}
                isPast={isPast}
                outOfWindow={outOfWindow}
                next={next}
                followedTeamIds={followedTeamIds}
                onGoTo={(key) => {
                  track('home_next_matchday_opened', { days_ahead: dayDiff(key, selectedDate) });
                  setSelectedDate(key);
                  window.scrollTo({ top: 0 });
                }}
              />
            ) : (
              <DayCards
                view={view}
                followedTeamIds={followedTeamIds}
                listAd
                afterFirst={
                  <>
                    {/* Publicidad y onboarding, nunca antes del primer partido.
                        Si AdBanner no procede (Premium/sin config) no deja hueco. */}
                    <AdBanner zone="home-top" />
                    {!followsSomething && <FavoritesOnboarding className="2xl:hidden" />}
                  </>
                }
              />
            )}
          </div>

          {/* Carril de contexto — solo en pantallas muy anchas. */}
          <DesktopAside
            className="hidden 2xl:block"
            matches={matches}
            favorites={favorites}
            leagues={leagues}
            todayKey={todayKey}
          />
        </div>
      </div>
    </div>
  );
}
