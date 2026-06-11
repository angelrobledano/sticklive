'use client';

import { useCallback, useRef, useEffect } from 'react';
import { useT } from '@/lib/i18n';

/** Crea un array de Date centrado en hoy con `before` días antes y `after` días después */
function buildDateRange(before = 7, after = 7): Date[] {
  const dates: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = -before; i <= after; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(d);
  }
  return dates;
}

/** Convierte Date a clave "YYYY-MM-DD" (sin timezone) */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getRelativeKey(date: Date, today: Date): string | null {
  const diff = Math.round(
    (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
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
}

export function DateSelector({ selected, onChange }: DateSelectorProps) {
  const { t, locale } = useT();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dates = buildDateRange(7, 14);
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
      className="flex gap-1.5 overflow-x-auto py-2.5 px-4 scrollbar-none"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      {dates.map((date) => {
        const key = toDateKey(date);
        const isActive = key === selected;
        const relKey = getRelativeKey(date, today);
        const relLabel = relKey ? t(relKey) : null;

        return (
          <button
            key={key}
            data-active={isActive}
            onClick={() => handleClick(key)}
            className={`flex flex-col items-center shrink-0 rounded-xl px-3 py-1.5
                        min-w-[52px] transition-all duration-150 select-none
                        ${isActive
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
                <span className="text-[9px] leading-none mt-0.5 opacity-70">
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
