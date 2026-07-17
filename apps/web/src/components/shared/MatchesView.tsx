'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { Match } from '@/lib/api/client';
import { useFavorites } from '@/hooks/useFavorites';
import { useLiveScores } from '@/hooks/useLiveScores';
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

/** Etiqueta de competición sobre un partido (en listas con competiciones mezcladas). */
function CompetitionCaption({ name }: { name?: string | null }) {
  if (!name) return null;
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1 pb-0.5">
      {name}
    </p>
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
                <li key={m.id}>
                  <CompetitionCaption name={m.competitionName} />
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

  // Los no-favoritos se agrupan POR COMPETICIÓN (antes había una cabecera fija
  // "OK Liga Masculina" que etiquetaba mal los partidos de otras competiciones).
  const restByCompetition = useMemo(() => {
    const map = new Map<string, Match[]>();
    for (const m of restMatches) {
      const key = m.competitionName ?? 'Otras competiciones';
      const arr = map.get(key);
      if (arr) arr.push(m); else map.set(key, [m]);
    }
    return Array.from(map.entries());
  }, [restMatches]);

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
                      <CompetitionCaption name={m.competitionName} />
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
            {restByCompetition.map(([comp, ms]) => (
              <section key={comp}>
                <SectionHeader label={comp} count={ms.length} />
                <ul className="px-4 space-y-2 pb-4">
                  {ms.map((m) => (
                    <li key={m.id}>
                      <MatchCard match={m} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
