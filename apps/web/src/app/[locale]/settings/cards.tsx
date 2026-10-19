'use client';

import { useState } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useT, SUPPORTED_LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import { useFavorites } from '@/hooks/useFavorites';

// ─── Selector de idioma (fila dentro de "Apariencia") ───

export function LanguageRow() {
  const { locale, setLocale, t } = useT();
  return (
    <div className="flex items-center gap-3 py-3.5">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{t('common.language')}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
          {t('settings.language_desc')}
        </p>
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

// ─── Cuenta (autenticación progresiva) ───

const SMALL_BUTTON =
  'inline-flex items-center justify-center min-h-[44px] px-3 rounded-lg text-xs font-semibold ' +
  'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion/60 ' +
  'dark:focus-visible:ring-rink-accent/60';

export function AccountCard() {
  const { email, isAuthenticated, logout, mounted } = useAuth();
  const { t } = useT();
  const [confirming, setConfirming] = useState(false);
  if (!mounted) return null;

  if (!isAuthenticated) {
    return (
      <Link href="/login" className="flex items-center gap-3 py-3.5 group">
        <div className="w-10 h-10 rounded-full bg-rink-passion/10 dark:bg-rink-accent/15 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 text-rink-passion dark:text-rink-accent">
            <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-50">{t('settings.account_login')}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {t('settings.account_login_desc')}
          </p>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
             className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0 group-hover:text-rink-passion dark:group-hover:text-rink-accent transition-colors">
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 py-3.5">
        <div className="w-10 h-10 rounded-full bg-rink-passion/10 dark:bg-rink-accent/15 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-rink-passion dark:text-rink-accent">
            {(email ?? '').trim().charAt(0).toUpperCase() || '·'}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{email}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('settings.account_synced')}</p>
        </div>
        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={`${SMALL_BUTTON} text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800`}
          >
            {t('settings.logout')}
          </button>
        )}
      </div>

      {confirming && (
        <div className="flex flex-wrap items-center justify-between gap-3 py-2" aria-live="polite">
          <p className="text-xs text-slate-600 dark:text-slate-300">{t('settings.logout_confirm')}</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={`${SMALL_BUTTON} text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800`}
            >
              {t('settings.logout_cancel')}
            </button>
            <button
              type="button"
              onClick={logout}
              className={`${SMALL_BUTTON} text-white bg-rink-passion hover:bg-rink-passion-light`}
            >
              {t('settings.logout')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Resumen de favoritos (la gestión vive en /favorites) ───

export function FavoritesSummary() {
  const { favorites, leagues, players, mounted } = useFavorites();
  const { t } = useT();

  if (!mounted) {
    return <div className="my-3 h-16 rounded-lg bg-slate-100 dark:bg-slate-800/60 animate-pulse" aria-hidden="true" />;
  }

  const total = favorites.length + leagues.length + players.length;

  return (
    <>
      {total === 0 ? (
        <div className="py-4 space-y-1.5">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{t('settings.fav_empty_title')}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {t('favorites.onboarding_body')}
          </p>
          <Link
            href="/competitions"
            className="inline-flex items-center min-h-[44px] text-xs font-semibold text-rink-passion dark:text-rink-accent hover:underline"
          >
            {t('favorites.onboarding_cta')}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 py-4">
          {[
            { value: favorites.length, label: t('settings.my_teams') },
            { value: leagues.length, label: t('settings.my_leagues') },
            { value: players.length, label: t('settings.my_players') },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg bg-slate-50 dark:bg-slate-800/40 px-3 py-2.5">
              <p className={`text-lg font-bold tabular-nums leading-none ${
                stat.value > 0 ? 'text-slate-900 dark:text-slate-50' : 'text-slate-400 dark:text-slate-500'
              }`}>
                {stat.value}
              </p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 leading-tight">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      )}

      <Link href="/favorites" className="flex items-center gap-3 py-3.5 group">
        <span className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200">
          {t('favorites.manage_favs')}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
             className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0 group-hover:text-rink-passion dark:group-hover:text-rink-accent transition-colors">
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </>
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
