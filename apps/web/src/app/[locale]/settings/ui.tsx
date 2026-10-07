'use client';

import type { ReactNode } from 'react';
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
          ? 'bg-gradient-to-r from-rink-passion to-red-600 shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]'
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
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-1">
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
