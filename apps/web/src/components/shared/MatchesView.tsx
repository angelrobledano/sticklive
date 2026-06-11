'use client';

import { useState, useMemo, useRef } from 'react';
import type { Match } from '@/lib/api/client';
import { useFavorites } from '@/hooks/useFavorites';
import { DateSelector, toDateKey } from '@/components/shared/DateSelector';
import { MatchCard } from '@/components/shared/MatchCard';
import { AdBanner } from '@/components/shared/AdBanner';
import Link from 'next/link';
import { useT } from '@/lib/i18n';

/** Nº de partidos favoritos visibles antes de colapsar el resto */
const FAV_PREVIEW = 3;

interface MatchesViewProps {
  matches: Match[];
}

/** Extrae la fecha local España de un ISO string */
function getSpainDateKey(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-ES', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).split('/').reverse().join('-'); // dd/mm/yyyy → yyyy-mm-dd
}

function EmptyState() {
  const { t } = useT();
  return (
    <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
      <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800
                      flex items-center justify-center mb-4">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
             className="w-8 h-8 text-slate-400">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
        </svg>
      </div>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
        {t('common.no_matches_day')}
      </p>
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

export function MatchesView({ matches }: MatchesViewProps) {
  const todayKey = toDateKey(new Date());
  const [selectedDate, setSelectedDate] = useState<string>(todayKey);
  const [showAllFavs, setShowAllFavs] = useState(false);
  const { favorites, isFavorite } = useFavorites();
  const { t } = useT();

  // ── Swipe horizontal: día anterior / siguiente ─────────────────────────────
  const shiftDay = (delta: number) => {
    setSelectedDate((prev) => {
      const d = new Date(`${prev}T12:00:00`); // mediodía: inmune a DST
      d.setDate(d.getDate() + delta);
      // Mantenerse dentro de la ventana del DateSelector (hoy ± 7 días)
      const diffDays = Math.round((d.getTime() - new Date(`${todayKey}T12:00:00`).getTime()) / 86_400_000);
      if (Math.abs(diffDays) > 7) return prev;
      return toDateKey(d);
    });
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
    () => matches.filter((m) => getSpainDateKey(m.scheduledAt) === selectedDate),
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
          <EmptyState />
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
