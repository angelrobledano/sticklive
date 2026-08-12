'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';

const DISMISS_KEY = 'rink-auth-upsell-dismissed';
export const UPSELL_EVENT = 'rink-auth-upsell';

/**
 * Bottom sheet de conversión a cuenta: se dispara (una vez) al marcar el
 * tercer favorito en estado anónimo. No bloquea — "Continuar como invitado"
 * siempre visible. Montado una sola vez en el layout raíz.
 */
export function AuthUpsell() {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => {
      try {
        if (localStorage.getItem(DISMISS_KEY)) return;
        if (localStorage.getItem('rink-session')) return; // ya tiene cuenta
      } catch { /* noop */ }
      setOpen(true);
    };
    window.addEventListener(UPSELL_EVENT, handler);
    return () => window.removeEventListener(UPSELL_EVENT, handler);
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
    setOpen(false);
  };

  // Cierra con Escape mientras está abierto (igual que NotificationPresetSheet)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center md:justify-center">
      {/* Backdrop */}
      <div aria-hidden="true" className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={dismiss} />

      {/* Sheet (móvil) / modal (escritorio) */}
      <div role="dialog" aria-modal="true" aria-labelledby="auth-upsell-title"
           className="relative w-full md:max-w-sm bg-white dark:bg-slate-900
                      rounded-t-3xl md:rounded-2xl p-6 pb-8 md:pb-6 space-y-4 shadow-2xl
                      animate-[slideUp_.25s_ease-out]">
        <div className="mx-auto w-10 h-1 rounded-full bg-slate-200 dark:bg-slate-700 md:hidden" />

        <div className="text-center space-y-1.5">
          <h2 id="auth-upsell-title" className="text-lg font-extrabold text-slate-900 dark:text-slate-50">
            {t('auth.upsell_title')}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            {t('auth.upsell_body')}
          </p>
        </div>

        <div className="space-y-2.5">
          <Link href="/login" onClick={() => setOpen(false)}
                className="block w-full min-h-[48px] leading-[48px] text-center rounded-xl
                           bg-rink-passion text-white text-sm font-semibold hover:opacity-90 transition-opacity">
            {t('auth.upsell_google')}
          </Link>
          <Link href="/login" onClick={() => setOpen(false)}
                className="block w-full min-h-[48px] leading-[48px] text-center rounded-xl
                           border border-slate-200 dark:border-slate-700 text-sm font-semibold
                           text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            {t('auth.upsell_email')}
          </Link>
          <button onClick={dismiss}
                  className="block w-full py-2.5 text-center text-xs font-medium
                             text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            {t('auth.upsell_guest')}
          </button>
        </div>
      </div>
    </div>
  );
}
