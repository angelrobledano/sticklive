'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';

// ─── Toggle iOS-style ───

export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** Nombre accesible del interruptor (4.1.2). Sin él, un SR solo lee "interruptor". */
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative w-12 h-7 rounded-full shrink-0 transition-all duration-200 ease-out
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion/60 dark:focus-visible:ring-rink-accent/60 focus-visible:ring-offset-2
                  dark:focus-visible:ring-offset-slate-900 ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${
        checked
          ? 'bg-gradient-to-r from-rink-passion to-rink-passion-light shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]'
          : 'bg-slate-200 dark:bg-slate-700/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white
                    shadow-[0_1px_3px_rgba(0,0,0,0.3)]
                    transition-transform duration-200 ease-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// ─── Fila de ajuste genérica ───

export function SettingRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-snug">
          {label}
        </p>
        {description && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
            {description}
          </p>
        )}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  );
}

// ─── Bloque de ajuste con título ───

export function SettingsBlock({
  title,
  icon,
  children,
  id,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  /** Ancla de sección para la navegación interna de Ajustes. */
  id?: string;
}) {
  return (
    <section id={id} className="space-y-1 scroll-mt-20">
      <div className="flex items-center gap-2 px-1 mb-2">
        <span className="text-slate-500 dark:text-slate-400">{icon}</span>
        <h2 className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          {title}
        </h2>
      </div>
      <div className="card px-4 divide-y divide-slate-100 dark:divide-slate-800/60">
        {children}
      </div>
    </section>
  );
}

// ─── Control segmentado (tema) ───

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  /** Nombre accesible del grupo. */
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex w-full sm:w-auto p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`flex-1 sm:flex-none min-h-[36px] px-3 rounded-lg text-xs font-semibold
                        transition-colors focus:outline-none focus-visible:ring-2
                        focus-visible:ring-rink-passion/60 dark:focus-visible:ring-rink-accent/60 ${
              active
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Navegación interna de Ajustes ───

export function SettingsNav({ items }: { items: Array<{ id: string; label: string }> }) {
  const { t } = useT();
  const [active, setActive] = useState(items[0]?.id ?? '');

  // Scroll-spy determinista: la sección activa es la última cuyo inicio ya ha
  // cruzado el borde superior de la ventana (por debajo de la barra sticky).
  useEffect(() => {
    const onScroll = () => {
      let current = items[0]?.id ?? '';
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top <= 120) current = item.id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [items]);

  return (
    <nav
      aria-label={t('settings.sections_nav')}
      className="sm:sticky sm:top-0 z-20 -mx-4 px-4 py-2
                 bg-slate-50/95 dark:bg-[#0b1220]/95 sm:backdrop-blur
                 border-b border-slate-200/70 dark:border-slate-800/70"
    >
      <ul className="flex flex-wrap gap-1.5 sm:flex-nowrap sm:overflow-x-auto sm:scrollbar-none">
        {items.map((item) => {
          const current = active === item.id;
          return (
            <li key={item.id} className="shrink-0">
              <a
                href={`#${item.id}`}
                aria-current={current ? 'true' : undefined}
                onClick={() => setActive(item.id)}
                className={`inline-flex items-center min-h-[36px] px-3 rounded-full text-xs font-semibold
                            transition-colors focus:outline-none focus-visible:ring-2
                            focus-visible:ring-rink-passion/60 dark:focus-visible:ring-rink-accent/60 ${
                  current
                    ? 'bg-rink-passion/10 text-rink-passion dark:bg-rink-accent/15 dark:text-rink-accent'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ─── Badge "Ya eres Premium" ───

export function PremiumActiveBadge() {
  const { t } = useT();
  return (
    <div className="rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 p-4
                    flex items-center gap-3 shadow-sm">
      <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white">
          <path d="M12 2L9 9 2 9l5.5 4-2 7L12 16l6.5 4-2-7L22 9l-7 0z" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-bold text-slate-900">{t('settings.premium_active')}</p>
        <p className="text-xs text-slate-900/80">{t('settings.premium_thanks')}</p>
      </div>
    </div>
  );
}
