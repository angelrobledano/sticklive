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
import { CountryPicker } from '@/components/shared/CountryPicker';
import { usePreferredCountry } from '@/hooks/usePreferredCountry';
import { AdBanner } from '@/components/shared/AdBanner';
import { adsenseConfig, listAdInsertIndex } from '@/lib/ads';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { track } from '@/lib/analytics';
import { madridTodayKey, addDaysToKey, dayDiff } from '@/lib/match-time';
import { useViewerTz } from '@/hooks/useViewerTz';
import { dateKeyIn, todayKeyIn } from '@/lib/viewer-tz-core';
import { buildDayView, nextMatchday, daysWithMatches, defaultOpenKeys, type DayFilter, type DayView } from '@/lib/day-view';
import { getMatchesInRange, getFeedInRange, getFollowingMatches } from '@/lib/api/client';
import { dayFetchRange, windowFromDays, nextDayWithMatches, hiddenForDay } from '@/lib/home-loading';
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
 * Carril de contexto en escritorio ancho (xl+, antes 2xl): "Mi grada" si sigues a
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
  // "Mi grada" mira varios días (próximos y últimos de tus equipos). La home
  // ya no trae la ventana entera, así que se pide aparte y SOLO si el carril
  // se ve (xl) y sigues algo: el resto de pantallas no paga esa descarga.
  const [wide, setWide] = useState<Match[] | null>(null);
  useEffect(() => {
    if (!follows || wide) return;
    if (typeof window === 'undefined' || !window.matchMedia('(min-width: 1280px)').matches) return;
    let cancelled = false;
    // Solo lo seguido (scope=following): antes se bajaba la ventana entera (~3 MB).
    getFollowingMatches({ teams: favorites, leagues })
      .then((m) => { if (!cancelled) setWide(m); })
      .catch(() => { /* se queda con el día */ });
    return () => { cancelled = true; };
  }, [follows, wide, favorites, leagues]);
  return (
    <aside className={`shrink-0 ${className}`}>
      <div className="rail-scroll sticky top-[76px] flex max-h-[calc(100vh-92px)] flex-col gap-4 overflow-y-auto pb-1">
        {follows ? (
          <MiGrada matches={wide ?? matches} teamIds={favorites} leagueIds={leagues} todayKey={todayKey} />
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

/**
 * Onboarding de favoritos (auditoría UX 03/11/2026, #2): una franja de una
 * línea sobre la jornada, descartable. Antes era una tarjeta entre el primer
 * bloque y el resto, que con el anuncio dejaba el primer partido a ~1.000 px.
 */
const ONBOARDING_DISMISSED_KEY = 'rink-onboarding-dismissed';

function FavoritesOnboarding({ className = '' }: { className?: string }) {
  const { t } = useT();
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1') setDismissed(true); } catch { /* noop */ }
  }, []);
  if (dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1'); } catch { /* noop */ }
    track('home_onboarding_dismissed', {});
  };
  return (
    <div className={`mb-3 flex items-center gap-2 rounded-xl bg-rink-passion/5 pl-3 dark:bg-rink-accent/10 ${className}`}>
      <span aria-hidden="true" className="text-rink-passion dark:text-rink-accent">★</span>
      <Link href="/favorites?onboarding=1"
            className="flex min-h-[44px] min-w-0 flex-1 items-center text-[13px] font-semibold text-slate-800 hover:underline dark:text-slate-100">
        {tt(t, 'favorites.onboarding_strip', 'Sigue a tu equipo y verás sus partidos aquí arriba')} →
      </Link>
      <button type="button" onClick={dismiss}
              aria-label={tt(t, 'favorites.onboarding_dismiss', 'Ocultar')}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
        </svg>
      </button>
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
function DayCards({ view, followedTeamIds, showDate = false, afterFirst, listAd = false, country = null }: {
  view: DayView<Match>;
  followedTeamIds: ReadonlySet<string>;
  showDate?: boolean;
  afterFirst?: ReactNode;
  listAd?: boolean;
  country?: string | null;
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
  const openKeys = defaultOpenKeys(view.competitions, country);
  let othersHeading = false;
  for (const block of view.competitions) {
    // «Otras competiciones» abiertas a mano: van detrás, con su cabecera.
    if (!block.inFeed && !othersHeading) {
      othersHeading = true;
      cards.push({
        key: '__others_heading__',
        rows: 0,
        node: (
          <div className="px-1 pt-2">
            {view.total === 0 && view.myTeams.length === 0 && (
              <p className="mb-1 text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                {tt(t, 'home.only_others', 'Este día no juegan tus equipos ni las destacadas. Esto es lo que hay:')}
              </p>
            )}
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {other}
            </h3>
          </div>
        ),
      });
    }
    cards.push({
      key: block.key || '__other__',
      rows: block.matches.length,
      node: (
        <MatchGroupCard
          title={block.name ? clubName(block.name) : other}
          href={block.id ? competitionPath(block.id, block.slug) : null}
          icon={<CompetitionIcon country={block.country} name={block.name} logoUrl={block.logoUrl} />}
          count={block.matches.length}
          followed={block.followed}
          defaultOpen={openKeys.has(block.key)}
          storageKey={`${view.dayKey}:${block.key || '__other__'}`}
          liveCount={block.matches.filter((m) => m.status === 'live').length}
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
 * «Ver N partidos de otras competiciones» (spec 2026-10-30): el catálogo que no
 * sale por defecto, a un toque. Abierto, permite volver a ocultarlo.
 */
function OthersToggle({ count, open, loading, onShow, onHide }: {
  count: number;
  open: boolean;
  loading: boolean;
  onShow: () => void;
  onHide: () => void;
}) {
  const { t } = useT();
  if (!open && count === 0) return null;
  return (
    <button
      type="button"
      onClick={open ? onHide : onShow}
      disabled={loading}
      aria-busy={loading}
      className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 text-[13px] font-semibold text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-50"
    >
      {open
        ? tt(t, 'home.others_hide', 'Ocultar otras competiciones')
        : tt(t, 'home.others_show', 'Ver otras competiciones ({n})', { n: count })}
    </button>
  );
}

/**
 * Día sin partidos: mensaje claro y, si el día es hoy o futuro, SOLO la
 * próxima jornada agrupada por competición (desplegada, con fecha en cada
 * fila) y un botón para ir a ese día.
 */
function EmptyDay({ hasOthers = false, isToday, isPast, outOfWindow, next, followedTeamIds, onGoTo }: {
  /** Hay partidos ese día, pero solo de competiciones que no salen por defecto. */
  hasOthers?: boolean;
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
    : hasOthers ? tt(t, 'home.no_featured_matches', 'Este día no juegan tus equipos ni las competiciones destacadas')
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
  /** Partidos del día de hoy (rango de `dayFetchRange(hoy)`), del SSR. */
  matches: Match[];
  /** Índice de días con partidos (`/matches/days`). Vacío si falló: se degrada a los partidos cargados. */
  days?: { day: string; count: number }[];
  /** Partidos de hoy fuera del feed según el SSR, por hora UTC («Ver otras competiciones»). */
  hiddenByHour?: Record<string, number>;
}

/**
 * Home (spec 2026-10-16, referencia FotMob): la jornada del día elegido en una
 * tarjeta por competición, con "Siguiendo" arriba y filtros En directo /
 * Siguiendo. Un día vacío enseña la próxima jornada. Lo personal que no es del
 * día (Mi grada) vive en Favoritos y en el carril de escritorio.
 */
export function MatchesView({ matches: initialMatches, days = [], hiddenByHour: ssrHidden = {} }: MatchesViewProps) {
  // Refresco en vivo: mientras haya partidos en juego, la lista se sincroniza con
  // el resultado real sondeando /current sin caché (la home es SSR y, si no, el
  // marcador quedaría congelado frente al detalle, que sí va por SSE).
  // La reconciliación pide solo el día visible (ref: el hook no se recrea).
  const selectedRef = useRef<string>(madridTodayKey());
  // Lo que sigue el usuario y su país: decide qué partidos salen (spec 2026-10-30).
  const feedRef = useRef<{ teams: string[]; leagues: string[]; country: string | null }>({ teams: [], leagues: [], country: null });
  const reconcile = useCallback(async () => {
    const { from, to } = dayFetchRange(selectedRef.current);
    return (await getFeedInRange(from, to, feedRef.current, true)).matches;
  }, []);
  const { matches, degraded, addMatches } = useLiveScores(initialMatches, { reconcile });

  // "Hoy" anclado en Europe/Madrid: misma autoridad horaria que usa el filtrado
  // de partidos. Estable en SSR (servidor UTC) y en cualquier TZ del dispositivo.
  // Días y "hoy" en la zona de quien mira (SSR e hidratación: Madrid).
  const viewerTz = useViewerTz();
  const todayKey = todayKeyIn(viewerTz);
  const { favorites, leagues } = useFavorites();
  const { country } = usePreferredCountry();
  feedRef.current = { teams: favorites, leagues, country };
  // Firma de lo que decide el feed: si cambia (sigue un equipo, cambia de
  // país), los días se vuelven a pedir. El SSR trae hoy sin follows ni país.
  const feedSig = `${favorites.join(',')}|${leagues.join(',')}|${country ?? ''}`;
  const [selectedDate, setSelectedDateState] = useState<string>(todayKey);
  const pickedRef = useRef(false);

  // El día elegido sobrevive al pull-to-refresh (sessionStorage: muere al
  // cerrar la pestaña, así mañana la app vuelve a abrir en "hoy").
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('rink-selected-date');
      if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) {
        if (Math.abs(dayDiff(saved, todayKey)) <= 7) { pickedRef.current = true; setSelectedDateState(saved); }
      }
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  selectedRef.current = selectedDate;

  // ── Carga por día (plan 2026-10-25, iteración 2; spec 2026-10-30) ─────────
  // Cada día se pide con scope=feed (destacadas + lo seguido) al abrirlo y se
  // acumula. «Otras competiciones» se piden aparte, solo si el usuario las abre.
  // Las claves llevan la firma del feed: el SSR cargó hoy sin follows ni país.
  const [loadedDays, setLoadedDays] = useState<ReadonlySet<string>>(() => new Set([`${todayKey}#||`]));
  const [loadingDays, setLoadingDays] = useState<ReadonlySet<string>>(() => new Set());
  const [failedDay, setFailedDay] = useState<string | null>(null);
  const [hiddenByDay, setHiddenByDay] = useState<Readonly<Record<string, number>>>(() => ({ [todayKey]: hiddenForDay(ssrHidden, todayKey, viewerTz) }));
  const isLoaded = useCallback((key: string) => loadedDays.has(`${key}#${feedSig}`), [loadedDays, feedSig]);
  // Un día que falla NO se reintenta solo: cada cambio de estado recrea
  // `loadDay` y el efecto lo volvería a llamar en bucle (tormenta de peticiones
  // con la API caída). Se reintenta con el botón (`force`).
  const failedTags = useRef<Set<string>>(new Set());
  const loadDay = useCallback((key: string, force = false) => {
    const tag = `${key}#${feedSig}`;
    if (isLoaded(key) || loadingDays.has(tag)) return;
    if (failedTags.current.has(tag) && !force) return;
    failedTags.current.delete(tag);
    setLoadingDays((s) => new Set(s).add(tag));
    setFailedDay(null);
    const { from, to } = dayFetchRange(key);
    getFeedInRange(from, to, feedRef.current)
      .then(({ matches: more, hiddenByHour }) => {
        addMatches(more);
        setHiddenByDay((h) => ({ ...h, [key]: hiddenForDay(hiddenByHour, key, viewerTz) }));
        setLoadedDays((s) => new Set(s).add(tag));
      })
      .catch(() => { failedTags.current.add(tag); setFailedDay(key); })
      .finally(() => setLoadingDays((s) => { const n = new Set(s); n.delete(tag); return n; }));
  }, [isLoaded, loadingDays, addMatches, feedSig, viewerTz]);

  // «Otras competiciones» del día: el resto del catálogo, bajo demanda.
  const [othersDays, setOthersDays] = useState<ReadonlySet<string>>(() => new Set());
  const [othersLoading, setOthersLoading] = useState(false);
  const showOthers = useCallback((key: string, auto = false) => {
    setOthersLoading(true);
    const { from, to } = dayFetchRange(key);
    getMatchesInRange(from, to)
      .then((all) => {
        addMatches(all);
        setOthersDays((s) => new Set(s).add(key));
        track('home_others_opened', { hidden: hiddenByDay[key] ?? 0, auto });
      })
      .catch(() => { /* el botón sigue ahí para reintentar */ })
      .finally(() => setOthersLoading(false));
  }, [addMatches, hiddenByDay]);

  // Si "hoy" cambia al conocer la zona del dispositivo (p. ej. de noche fuera
  // de España) y el usuario no ha elegido día, se sigue a "hoy".
  useEffect(() => {
    if (!pickedRef.current) setSelectedDateState(todayKey);
  }, [todayKey]);

  const setSelectedDate = useCallback((key: string) => {
    pickedRef.current = true;
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
    () => buildDayView(matches, {
      dayKey: selectedDate, teamIds: favorites, leagueIds: leagues, filter: requestedFilter, locale, country, tz: viewerTz,
      includeOthers: othersDays.has(selectedDate),
    }),
    [matches, selectedDate, favorites, leagues, requestedFilter, locale, country, viewerTz, othersDays],
  );
  // Partidos del día fuera del feed: los cargados o, si aún no, los que dijo la API.
  const othersCount = othersDays.has(selectedDate) ? 0 : Math.max(view.hiddenCount, hiddenByDay[selectedDate] ?? 0);
  // Día sin feed pero con partidos: se enseñan directamente las demás
  // competiciones en vez de un estado vacío (una vez por día; si el usuario
  // las oculta, no se vuelven a abrir solas).
  const [autoOthersTried, setAutoOthersTried] = useState<ReadonlySet<string>>(() => new Set());
  const feedEmpty = view.total === 0 && view.myTeams.length === 0;
  const autoOthers = feedEmpty && othersCount > 0 && !othersDays.has(selectedDate);
  useEffect(() => {
    if (!autoOthers || othersLoading || !isLoaded(selectedDate) || autoOthersTried.has(selectedDate)) return;
    setAutoOthersTried((s) => new Set(s).add(selectedDate));
    showOthers(selectedDate, true);
  }, [autoOthers, othersLoading, isLoaded, selectedDate, showOthers, autoOthersTried]);
  const isPast = selectedDate < todayKey;
  const dayKeys = useMemo(() => days.filter((d) => d.count > 0).map((d) => d.day), [days]);

  useEffect(() => { loadDay(selectedDate); }, [selectedDate, loadDay]);
  const selectedLoading = !isLoaded(selectedDate);

  // Día vacío → próxima jornada: el índice dice qué día es; se carga si falta.
  const nextKey = !selectedLoading && view.total === 0 && !isPast
    ? nextDayWithMatches(dayKeys, selectedDate)
    : null;
  useEffect(() => { if (nextKey) loadDay(nextKey); }, [nextKey, loadDay]);
  const nextLoaded = nextKey ? isLoaded(nextKey) : false;
  const next = useMemo(() => {
    if (selectedLoading || view.total > 0 || isPast) return null;
    // Sin índice de días (falló /matches/days): se busca en lo ya cargado.
    if (dayKeys.length === 0) {
      return nextMatchday(matches, selectedDate, { teamIds: favorites, leagueIds: leagues, locale, country, tz: viewerTz });
    }
    return nextKey && nextLoaded
      ? buildDayView(matches, { dayKey: nextKey, teamIds: favorites, leagueIds: leagues, filter: 'all', locale, country, tz: viewerTz })
      : null;
  }, [selectedLoading, view.total, isPast, dayKeys.length, nextKey, nextLoaded, matches, selectedDate, favorites, leagues, locale, country, viewerTz]);
  const markedDays = useMemo(
    () => (dayKeys.length > 0 ? new Set(dayKeys) : daysWithMatches(matches, viewerTz)),
    [dayKeys, matches, viewerTz],
  );

  // Rango de días con datos cargados (#365): acota el DateSelector para no
  // ofrecer días que la ventana del API no cubre y que saldrían vacíos.
  const windowRange = useMemo(() => {
    if (dayKeys.length > 0) return windowFromDays(dayKeys, todayKey);
    let from: string | null = null;
    let to: string | null = null;
    for (const m of matches) {
      const k = dateKeyIn(m.scheduledAt, viewerTz);
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
  }, [dayKeys, matches, todayKey, viewerTz]);
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
                        xl:max-w-[1150px] xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {/* Contexto para lectores de pantalla: de qué día son las tarjetas
                (cada tarjeta es un h3). */}
            <h2 className="sr-only">{longDayLabel(selectedDate, locale, true)}</h2>
            {/* Sin chips del día, el selector de país va solo y a la izquierda,
                como un filtro más (04/11/2026). Con chips, a su derecha. */}
            <div className="flex items-start gap-2">
              <div className={view.liveCount > 0 || view.followingCount > 0 ? 'min-w-0 flex-1' : 'hidden'}>
                <DayChips
                  liveCount={view.liveCount}
                  followingCount={view.followingCount}
                  filter={view.filter}
                  onChange={onFilterChange}
                  degraded={degraded}
                />
              </div>
              <div className="pb-3"><CountryPicker /></div>
            </div>
            {!followsSomething && <FavoritesOnboarding className="xl:hidden" />}

            {selectedLoading || (autoOthers && (othersLoading || !autoOthersTried.has(selectedDate))) ? (
              selectedLoading && failedDay === selectedDate ? (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    {tt(t, 'errors.matches_load_title', 'No hemos podido cargar los partidos')}
                  </p>
                  <button type="button" onClick={() => loadDay(selectedDate, true)}
                          className="min-h-[44px] rounded-xl px-4 text-sm font-semibold text-rink-passion hover:underline dark:text-rink-accent">
                    {tt(t, 'errors.retry', 'Reintentar')}
                  </button>
                </div>
              ) : (
                <div role="status" aria-busy="true" className="space-y-3">
                  <span className="sr-only">{tt(t, 'common.loading', 'Cargando…')}</span>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="card h-24 animate-pulse bg-slate-100 dark:bg-slate-800" />
                  ))}
                </div>
              )
            ) : view.myTeams.length === 0 && view.competitions.length === 0 ? (
              <EmptyDay
                hasOthers={othersCount > 0}
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
                country={country}
                listAd
                afterFirst={
                  <>
                    {/* Publicidad y onboarding, nunca antes del primer partido.
                        Si AdBanner no procede (Premium/sin config) no deja hueco. */}
                    <AdBanner zone="home-top" />
                  </>
                }
              />
            )}
            {!selectedLoading && !(feedEmpty && othersDays.has(selectedDate)) && (
              <OthersToggle
                count={othersCount}
                open={othersDays.has(selectedDate)}
                loading={othersLoading}
                onShow={() => showOthers(selectedDate)}
                onHide={() => setOthersDays((s) => { const n = new Set(s); n.delete(selectedDate); return n; })}
              />
            )}
          </div>

          {/* Carril de contexto — solo en pantallas muy anchas. */}
          <DesktopAside
            className="hidden xl:block"
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
