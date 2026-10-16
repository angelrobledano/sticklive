'use client';

import { useEffect, useRef, useState } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useT } from '@/lib/i18n';

const DISMISS_KEY = 'rink-auth-upsell-dismissed';
export const UPSELL_EVENT = 'rink-auth-upsell';

/** Selector de elementos tabulables dentro de un diálogo modal. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * #359: índice destino al tabular dentro de un diálogo (trap de foco). Pura para
 * poder fijarla sin navegador: envuelve el final→principio y viceversa.
 */
export function trapFocusIndex(current: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return backwards ? (current - 1 + count) % count : (current + 1) % count;
}

/**
 * Bottom sheet de conversión a cuenta: se dispara (una vez) al marcar el
 * tercer favorito en estado anónimo. No bloquea — "Continuar como invitado"
 * siempre visible. Montado una sola vez en el layout raíz.
 */
export function AuthUpsell() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

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

  // #359: foco inicial al primer control, trap de Tab y restauración al cerrar
  // (además de Escape y bloqueo del scroll de fondo), como en NotificationPresetSheet.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = (document.activeElement as HTMLElement | null) ?? null;

    const focusables = (): HTMLElement[] => {
      const root = dialogRef.current;
      return root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];
    };
    (focusables()[0] ?? dialogRef.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { dismiss(); return; }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const current = active ? list.indexOf(active) : -1;
      if (current === -1) { e.preventDefault(); list[0]!.focus(); return; }
      const target = trapFocusIndex(current, list.length, e.shiftKey);
      if (target !== current) { e.preventDefault(); list[target]!.focus(); }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end md:items-center md:justify-center">
      {/* Backdrop */}
      <div aria-hidden="true" className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={dismiss} />

      {/* Sheet (móvil) / modal (escritorio) */}
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="auth-upsell-title" tabIndex={-1}
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
