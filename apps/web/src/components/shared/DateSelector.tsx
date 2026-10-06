'use client';

import { useCallback, useRef, useEffect } from 'react';
import { useT } from '@/lib/i18n';
import { madridTodayKey, addDaysToKey, dayDiff } from '@/lib/match-time';

/**
 * Construye las claves "YYYY-MM-DD" del carrusel, centradas en el "hoy" de
 * Madrid. Se trabaja con claves (no con objetos Date locales) para que el
 * carrusel y el filtrado de partidos compartan exactamente la misma autoridad
 * horaria; si no, el día resaltado como "hoy" no casaría con el día filtrado.
 */
function buildDateKeys(before = 7, after = 14): string[] {
  const today = madridTodayKey();
  const keys: string[] = [];
  for (let i = -before; i <= after; i++) keys.push(addDaysToKey(today, i));
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

/** Abreviaturas de día/mes en el idioma activo (Intl, sin tablas a mano) */
function dayAbbr(date: Date, locale: string): string {
  const s = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
  return s.replace('.', '').slice(0, 3);
}
function monthAbbr(date: Date, locale: string): string {
  const s = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
  return s.replace('.', '').slice(0, 3);
}

interface DateSelectorProps {
  selected: string;          // "YYYY-MM-DD"
  onChange: (key: string) => void;
  /** Primer día con datos cargados (para no ofrecer días vacíos por ventana). */
  availableFrom?: string | null;
  /** Último día con datos cargados. */
  availableTo?: string | null;
}

export function DateSelector({ selected, onChange, availableFrom, availableTo }: DateSelectorProps) {
  const { t, locale } = useT();
  const todayKey = madridTodayKey();
  const dateKeys = buildDateKeys(7, 14);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Centrar el elemento activo al montar
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const active = container.querySelector('[data-active="true"]') as HTMLElement | null;
    if (active) {
      active.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
    }
  }, []);

  const handleClick = useCallback((key: string) => {
    onChange(key);
  }, [onChange]);

  return (
    <div className="relative border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      {/* Desvanecidos laterales: pista visual de que el carrusel es deslizable */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-6 z-10
                      bg-gradient-to-r from-white dark:from-slate-900 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-6 z-10
                      bg-gradient-to-l from-white dark:from-slate-900 to-transparent" />
    <div
      ref={scrollRef}
      className="flex gap-1.5 overflow-x-auto py-2.5 px-4 scrollbar-none
                 lg:mx-auto lg:w-fit lg:max-w-full lg:px-6"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      {dateKeys.map((key) => {
        const date = labelDate(key);
        const isActive = key === selected;
        const relKey = getRelativeKey(key, todayKey);
        const relLabel = relKey ? t(relKey) : null;
        // Fuera de la ventana de datos cargada: se muestra atenuado y deshabilitado
        // en vez de abrir un día que siempre saldría vacío en falso (#365).
        const outOfRange = (!!availableFrom && key < availableFrom)
          || (!!availableTo && key > availableTo);

        return (
          <button
            key={key}
            data-active={isActive}
            aria-current={isActive ? 'date' : undefined}
            disabled={outOfRange}
            title={outOfRange ? t('common.day_out_of_window') : undefined}
            onClick={() => handleClick(key)}
            className={`flex flex-col items-center shrink-0 rounded-xl px-3 py-1.5
                        min-w-[52px] transition-all duration-150 select-none
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
          </button>
        );
      })}
    </div>
    </div>
  );
}
