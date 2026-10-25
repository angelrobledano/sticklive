'use client';

import { useViewerTz } from '@/hooks/useViewerTz';
import { todayKeyIn } from '@/lib/viewer-tz-core';
import { memo, useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { addDaysToKey, dayDiff } from '@/lib/match-time';
import { computeDateWindow } from '@/lib/date-window';
import { tt } from '@/components/search/translate';

/**
 * Construye las claves "YYYY-MM-DD" del carrusel, centradas en el "hoy" de
 * Madrid. Se trabaja con claves (no con objetos Date locales) para que el
 * carrusel y el filtrado de partidos compartan exactamente la misma autoridad
 * horaria; si no, el día resaltado como "hoy" no casaría con el día filtrado.
 */
function buildDateKeys(todayKey: string, before = 7, after = 14): string[] {
  const keys: string[] = [];
  for (let i = -before; i <= after; i++) keys.push(addDaysToKey(todayKey, i));
  return keys;
}

/**
 * Date a mediodía para PINTAR etiquetas (día, mes, día de semana). El mediodía
 * hace que getDate()/Intl devuelvan el día correcto en cualquier TZ; solo se usa
 * para formateo visual, nunca para comparar o agrupar.
 */
function labelDate(key: string): Date {
  return new Date(`${key}T12:00:00`);
}

function getRelativeKey(key: string, todayKey: string): string | null {
  const diff = dayDiff(key, todayKey);
  if (diff === -1) return 'common.yesterday';
  if (diff === 0)  return 'common.today';
  if (diff === 1)  return 'common.tomorrow';
  return null;
}

/** Formatters de Intl cacheados por idioma: construir uno es caro y el
 *  selector pinta ~40 chips (móvil + escritorio) en cada render. */
const WEEKDAY_FMT = new Map<string, Intl.DateTimeFormat>();
const MONTH_FMT = new Map<string, Intl.DateTimeFormat>();

function weekdayFormatter(locale: string): Intl.DateTimeFormat {
  let fmt = WEEKDAY_FMT.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    WEEKDAY_FMT.set(locale, fmt);
  }
  return fmt;
}

function monthFormatter(locale: string): Intl.DateTimeFormat {
  let fmt = MONTH_FMT.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { month: 'short' });
    MONTH_FMT.set(locale, fmt);
  }
  return fmt;
}

/** Abreviaturas de día/mes en el idioma activo (Intl, sin tablas a mano) */
function dayAbbr(date: Date, locale: string): string {
  return weekdayFormatter(locale).format(date).replace('.', '').slice(0, 3);
}
function monthAbbr(date: Date, locale: string): string {
  return monthFormatter(locale).format(date).replace('.', '').slice(0, 3);
}

interface DateSelectorProps {
  selected: string;          // "YYYY-MM-DD"
  onChange: (key: string) => void;
  /** Primer día con datos cargados (para no ofrecer días vacíos por ventana). */
  availableFrom?: string | null;
  /** Último día con datos cargados. */
  availableTo?: string | null;
  /** Días con algún partido: llevan un punto bajo el número. */
  markedDays?: ReadonlySet<string>;
}

/**
 * Chip de día — compartido por el carrusel (móvil) y la tira paginada
 * (escritorio): mismo lenguaje visual, dos chasis de interacción.
 */
function DayChipImpl({ dateKey, selected, outOfRange, marked = false, todayKey, onClick }: {
  dateKey: string;
  selected: string;
  outOfRange: boolean;
  /** Día de "hoy" en Madrid, ya calculado por el padre (evita Intl por chip). */
  todayKey: string;
  /** El día tiene partidos (punto bajo el número). */
  marked?: boolean;
  onClick: (key: string) => void;
}) {
  const { t, locale } = useT();
  const date = labelDate(dateKey);
  const isActive = dateKey === selected;
  const relKey = getRelativeKey(dateKey, todayKey);
  const relLabel = relKey ? t(relKey) : null;

  return (
    <button
      type="button"
      data-active={isActive}
      aria-current={isActive ? 'date' : undefined}
      disabled={outOfRange}
      title={outOfRange ? t('common.day_out_of_window') : undefined}
      onClick={() => onClick(dateKey)}
      className={`relative flex flex-col items-center shrink-0 rounded-xl px-3 pt-1.5 pb-2.5
                  min-w-[52px] min-h-[44px] transition-all duration-150 select-none
                  ${outOfRange
                    ? 'opacity-30 cursor-not-allowed'
                    : isActive
                      ? 'bg-rink-passion/10 text-rink-passion'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
    >
      {relLabel ? (
        <>
          <span className="text-[10px] font-semibold uppercase tracking-wide leading-none mb-0.5">
            {relLabel}
          </span>
          <span className={`text-base font-bold leading-none
                            ${isActive ? 'text-rink-passion' : 'text-slate-700 dark:text-slate-200'}`}>
            {date.getDate()}
          </span>
        </>
      ) : (
        <>
          <span className="text-[10px] font-normal uppercase tracking-wide leading-none mb-0.5">
            {dayAbbr(date, locale)}
          </span>
          <span className={`text-base font-bold leading-none
                            ${isActive ? 'text-rink-passion' : 'text-slate-700 dark:text-slate-200'}`}>
            {date.getDate()}
          </span>
          <span className="text-[10px] leading-none mt-0.5 opacity-70">
            {monthAbbr(date, locale)}
          </span>
        </>
      )}
      <span
        aria-hidden="true"
        data-marked={marked ? 'true' : undefined}
        className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${marked
          ? isActive ? 'bg-rink-passion dark:bg-rink-accent' : 'bg-slate-400 dark:bg-slate-500'
          : 'bg-transparent'}`}
      />
    </button>
  );
}

const DayChip = memo(DayChipImpl);

/**
 * Selector de fecha con dos chasis (#414):
 *  · Móvil: carrusel deslizable de todos los días, centrado en el activo.
 *  · md+: tira compacta de 7 días con flechas que pagan semana a semana —
 *    navegación por teclado y flechas, sin una baranda de chips a todo el ancho.
 * La lógica de paginación vive en `lib/date-window` (pura, testeada).
 */
function DateSelectorImpl({ selected, onChange, availableFrom, availableTo, markedDays }: DateSelectorProps) {
  const { t } = useT();
  const todayKey = todayKeyIn(useViewerTz());
  const dateKeys = useMemo(() => buildDateKeys(todayKey, 7, 14), [todayKey]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Ventana de escritorio: null = auto-centrada en el día seleccionado; las
  // flechas la pagan y un cambio de selección vuelve a auto-centrarla.
  const [startOverride, setStartOverride] = useState<number | null>(null);
  useEffect(() => { setStartOverride(null); }, [selected]);
  const window7 = computeDateWindow(dateKeys, selected, startOverride);

  // Centrar el elemento activo (carrusel móvil): al montar sin animación y, si
  // el día cambia desde fuera (día guardado, "Ver el miércoles 21"), con ella.
  const centered = useRef(false);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const active = container.querySelector('[data-active="true"]') as HTMLElement | null;
    if (active) {
      active.scrollIntoView({ behavior: centered.current ? 'smooth' : 'instant', block: 'nearest', inline: 'center' });
      centered.current = true;
    }
  }, [selected]);

  const handleClick = useCallback((key: string) => {
    onChange(key);
  }, [onChange]);

  const isOutOfRange = useCallback((key: string) =>
    (!!availableFrom && key < availableFrom) || (!!availableTo && key > availableTo),
    [availableFrom, availableTo]);

  const arrowCls = (disabled: boolean) =>
    `shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-colors
     ${disabled
       ? 'opacity-30 cursor-not-allowed text-slate-300 dark:text-slate-600'
       : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200'}`;

  return (
    <div className="relative border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      {/* Móvil: carrusel deslizable, pista de desvanecidos en los bordes */}
      <div className="relative md:hidden">
        <div className="pointer-events-none absolute inset-y-0 left-0 w-6 z-10
                        bg-gradient-to-r from-white dark:from-slate-900 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 z-10
                        bg-gradient-to-l from-white dark:from-slate-900 to-transparent" />
        <div
          ref={scrollRef}
          className="flex gap-1.5 overflow-x-auto py-1.5 px-4 scrollbar-none"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {dateKeys.map((key) => (
            <DayChip key={key} dateKey={key} selected={selected} todayKey={todayKey}
                     outOfRange={isOutOfRange(key)} marked={!!markedDays?.has(key)}
                   onClick={handleClick} />
          ))}
        </div>
      </div>

      {/* Escritorio: 7 días + paginación por semanas */}
      <div className="hidden md:flex items-center justify-center gap-1.5 py-2 px-6">
        <button
          type="button"
          onClick={() => setStartOverride(window7.start - 7)}
          disabled={!window7.canPrev}
          aria-label={tt(t, 'common.prev_week', 'Semana anterior')}
          className={arrowCls(!window7.canPrev)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
               className="w-4 h-4" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {window7.keys.map((key) => (
          <DayChip key={key} dateKey={key} selected={selected} todayKey={todayKey}
                   outOfRange={isOutOfRange(key)} marked={!!markedDays?.has(key)}
                   onClick={handleClick} />
        ))}
        <button
          type="button"
          onClick={() => setStartOverride(window7.start + 7)}
          disabled={!window7.canNext}
          aria-label={tt(t, 'common.next_week', 'Semana siguiente')}
          className={arrowCls(!window7.canNext)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
               className="w-4 h-4" aria-hidden="true">
            <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Memoizado: la home se re-renderiza en cada poll del directo, pero el
 * selector de fecha solo cambia cuando cambia el día elegido (o sus marcas).
 */
export const DateSelector = memo(DateSelectorImpl);
