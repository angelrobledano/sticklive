'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { Match } from '@/lib/api/client';
import { useFavorites } from '@/hooks/useFavorites';
import { DateSelector } from '@/components/shared/DateSelector';
import { MatchCard } from '@/components/shared/MatchCard';
import { AdBanner } from '@/components/shared/AdBanner';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { madridDateKey, madridTodayKey, addDaysToKey, dayDiff } from '@/lib/match-time';

/** Nº de partidos favoritos visibles antes de colapsar el resto */
const FAV_PREVIEW = 3;

interface MatchesViewProps {
  matches: Match[];
}

/**
 * Estado vacío con vida: mini-pista animada (la bola cruza, gol y "¡GOL!")
 * y, si existe, un CTA al próximo día con partidos — el vacío se convierte
 * en navegación en vez de en un callejón sin salida.
 */
function EmptyState({ nextDate, onJump }: {
  /** Próximo día (clave yyyy-mm-dd) con partidos, si lo hay */
  nextDate: string | null;
  onJump: (dateKey: string) => void;
}) {
  const { t, locale } = useT();

  const nextLabel = nextDate
    ? new Date(`${nextDate}T12:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
    : null;

  return (
    <div className="flex flex-col items-center justify-center py-14 px-8 text-center">
      {/* Mini-pista animada */}
      <div className="relative w-[260px] h-[120px] mb-6 rounded-3xl overflow-hidden
                      bg-gradient-to-br from-sky-700 to-sky-800 dark:from-slate-700 dark:to-slate-800
                      border-[3px] border-sky-900/40 dark:border-slate-900/60">
        {/* Líneas */}
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/40" />
        <div className="absolute left-1/2 top-1/2 w-12 h-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40" />
        {/* Portería derecha + red que tiembla con el gol */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 w-1.5 h-9 bg-white/70 rounded"
             style={{ animation: 'rinkNet 3.2s ease-in-out infinite' }} />
        {/* Stick que golpea */}
        <div className="absolute left-7 top-1/2 -translate-y-1/2 origin-top"
             style={{ animation: 'rinkStick 3.2s ease-in-out infinite' }}>
          <div className="w-1.5 h-10 bg-white/90 rounded-full" />
          <div className="w-4 h-1.5 bg-white/90 rounded-full -mt-0.5" />
        </div>
        {/* La bola */}
        <div className="absolute left-12 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full
                        bg-slate-900 ring-1 ring-white/50"
             style={{ animation: 'rinkShot 3.2s ease-in-out infinite' }} />
        {/* ¡GOL! */}
        <span className="absolute right-9 top-1/2 -translate-y-1/2 text-[13px] font-black tracking-wider text-emerald-300"
              style={{ animation: 'rinkGoalFlash 3.2s ease-in-out infinite' }}>
          {t('common.goal_excl')}
        </span>
      </div>

      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
        {t('common.no_matches_day')}
      </p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
        {t('common.rink_resting')}
      </p>

      {nextDate && nextLabel && (
        <button
          onClick={() => onJump(nextDate)}
          className="mt-5 px-5 min-h-[44px] rounded-full bg-rink-passion text-white text-sm font-semibold
                     hover:opacity-90 active:scale-95 transition-all"
        >
          {t('common.next_matchday', { date: nextLabel })}
        </button>
      )}
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  const { t } = useT();
  return (
    <div className="flex items-center justify-between px-4 pt-5 pb-2">
      <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="text-[11px] font-light text-slate-400 dark:text-slate-600 tabular-nums">
        {count} {count === 1 ? t('common.match_lc') : t('common.matches_lc')}
      </span>
    </div>
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
function UpcomingMatches({ matches, selectedDate, todayKey }: {
  matches: Match[];
  selectedDate: string;
  todayKey: string;
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
        <p className="text-base font-bold text-slate-800 dark:text-slate-100">
          {isToday ? t('common.no_matches_today') : t('common.no_matches_this_day')}
        </p>
        {!isPast && groups.length > 0 && (
          <p className="text-xs text-slate-400 dark:text-slate-500">{t('common.upcoming_intro')}</p>
        )}
      </div>

      {isPast ? null : groups.length === 0 ? (
        <p className="text-center text-xs text-slate-400 dark:text-slate-500 px-8 pb-12">
          {t('common.no_upcoming')}
        </p>
      ) : (
        groups.map(([dateKey, ms]) => (
          <section key={dateKey}>
            <SectionHeader label={formatDateHeader(dateKey, locale)} count={ms.length} />
            <ul className="px-4 space-y-2 pb-2">
              {ms.map((m) => (
                <li key={m.id}><MatchCard match={m} /></li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

export function MatchesView({ matches }: MatchesViewProps) {
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
  const { favorites, isFavorite } = useFavorites();
  const { t } = useT();

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

  const hasBothSections = favMatches.length > 0 && restMatches.length > 0;

  return (
    <div className="flex flex-col min-h-screen">
      {/* Selector de fecha — sticky bajo el header */}
      <div className="sticky top-0 z-30">
        <DateSelector selected={selectedDate} onChange={setSelectedDate} />
      </div>

      {/*
        Banner home-top: justo bajo el DateSelector sticky.
        Al ser un cliente Premium, AdBanner devuelve null y el layout
        se estira limpiamente sin hueco.
        z-index inferior al DateSelector para no taparlo al hacer scroll.
      */}
      <AdBanner zone="home-top" className="z-20" />

      {/* Lista de partidos — con swipe horizontal para cambiar de día */}
      <div className="flex-1" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {dayMatches.length === 0 ? (
          <UpcomingMatches
            matches={matches}
            selectedDate={selectedDate}
            todayKey={todayKey}
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

            {/* Bloque principal — OK Liga */}
            {restMatches.length > 0 && (
              <section>
                <SectionHeader label="OK Liga Masculina" count={restMatches.length} />
                <ul className="px-4 space-y-2 pb-4">
                  {restMatches.map((m) => (
                    <li key={m.id}>
                      <MatchCard match={m} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
