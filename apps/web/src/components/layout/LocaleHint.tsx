'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { LOCALE_NAMES, isSupportedLocale, type Locale } from '@/lib/locales';

const DISMISS_KEY = 'rink-locale-hint-dismissed';
/** Elección manual previa (lo fija setLocale en localStorage). */
const CHOSEN_KEY = 'sticklive_locale';

/**
 * Aviso "ver en tu idioma" (#277): los enlaces compartidos llevan el prefijo del
 * emisor, así que el receptor ve siempre el idioma de quien comparte. Si el
 * idioma del navegador es otro (y el usuario no eligió idioma a mano), ofrecemos
 * un cambio con un clic, descartable.
 */
export function LocaleHint() {
  const { locale, setLocale, t } = useT();
  const [suggested, setSuggested] = useState<Locale | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(CHOSEN_KEY) || localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      return; // sin almacenamiento no insistimos
    }
    const primary = (navigator.language || '').slice(0, 2).toLowerCase();
    if (!isSupportedLocale(primary) || primary === locale) return;
    setSuggested(primary);
  }, [locale]);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
    setSuggested(null);
  };

  if (!suggested) return null;
  const langName = LOCALE_NAMES[suggested];

  return (
    <div
      role="status"
      className="fixed bottom-20 md:bottom-4 left-1/2 -translate-x-1/2 z-[65]
                 flex items-center gap-2 max-w-[92vw] px-4 py-2.5 rounded-full
                 bg-slate-900/95 dark:bg-slate-100/95 shadow-lg
                 text-xs font-medium text-white dark:text-slate-900
                 animate-[fadeIn_.15s_ease-out]"
    >
      <span className="whitespace-nowrap truncate">{t('locale_hint.body', { lang: langName })}</span>
      <button
        onClick={() => { setLocale(suggested); dismiss(); }}
        className="shrink-0 rounded-full px-2.5 py-1 font-bold bg-rink-passion text-white hover:opacity-90 transition-opacity"
      >
        {t('locale_hint.cta', { lang: langName })}
      </button>
      <button
        onClick={dismiss}
        aria-label={t('locale_hint.dismiss')}
        className="shrink-0 w-6 h-6 rounded-full hover:bg-white/10 dark:hover:bg-black/10 transition-colors"
      >
        ×
      </button>
    </div>
  );
}
