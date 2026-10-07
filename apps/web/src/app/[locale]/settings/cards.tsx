'use client';

import Link from 'next/link';
import { useT, SUPPORTED_LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';

// ─── Selector de idioma ───

export function LanguageCard() {
  const { locale, setLocale, t } = useT();
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 text-rink-passion">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{t('common.language')}</p>
      </div>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700
                   bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200
                   focus:outline-none focus:ring-2 focus:ring-rink-passion dark:focus:ring-rink-accent cursor-pointer"
        aria-label={t('common.language')}
      >
        {SUPPORTED_LOCALES.map((l) => (
          <option key={l} value={l}>{LOCALE_NAMES[l]}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Tarjeta de cuenta (autenticación progresiva) ───

export function AccountCard() {
  const { email, isAuthenticated, logout, mounted } = useAuth();
  const { t } = useT();
  if (!mounted) return null;

  if (isAuthenticated) {
    return (
      <div className="card p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-emerald-600 dark:text-emerald-400">
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{email}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('settings.account_synced')}</p>
        </div>
        <button onClick={logout}
                className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-red-500 transition-colors px-2 min-h-[44px]">
          {t('settings.logout')}
        </button>
      </div>
    );
  }

  return (
    <Link href="/login" className="card p-4 flex items-center gap-3 hover:shadow-md transition-shadow block
                                   border border-rink-passion/20 bg-rink-passion/[0.03]">
      <div className="w-10 h-10 rounded-full bg-rink-passion/10 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 text-rink-passion">
          <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">{t('settings.account_login')}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          {t('settings.account_login_desc')}
        </p>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-slate-300 shrink-0">
        <path d="M9 18l6-6-6-6" strokeLinecap="round" />
      </svg>
    </Link>
  );
}

// ─── Fila de favorito (equipo o liga) ───

export function FavoriteRow({ href, name, fallback, logoSrc, onRemove }: {
  href: string;
  name: string;
  fallback: string;
  logoSrc?: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden shrink-0">
        {logoSrc ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoSrc}
              alt={name}
              width={32}
              height={32}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-contain"
              onError={(e) => {
                const el = e.currentTarget;
                el.style.display = 'none';
                if (el.nextElementSibling) (el.nextElementSibling as HTMLElement).style.display = 'block';
              }}
            />
            <span style={{ display: 'none' }} className="text-[8px] font-bold text-slate-500 dark:text-slate-400 uppercase">
              {fallback}
            </span>
          </>
        ) : (
          <span className="text-[10px] font-black text-rink-passion uppercase">{fallback}</span>
        )}
      </div>
      <Link
        href={href}
        className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200 hover:text-rink-passion transition-colors truncate"
      >
        {name}
      </Link>
      <button
        onClick={onRemove}
        className="shrink-0 inline-flex items-center justify-center p-1.5 min-w-[44px] min-h-[44px] rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        aria-label="Dejar de seguir"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" strokeWidth={2}
             className="w-5 h-5 text-rink-passion">
          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      </button>
    </div>
  );
}

// ─── Sub-cabecera de sección dentro de un bloque ───

export function SubHeader({ label }: { label: string }) {
  return (
    <div className="pt-3 pb-1">
      <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
        {label}
      </p>
    </div>
  );
}
