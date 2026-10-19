'use client';

/**
 * <AdInterstitial />
 *
 * Overlay publicitario NO agresivo (desactivado por defecto con
 * `NEXT_PUBLIC_ADS_INTERSTITIAL=1`):
 *   • Nunca al cargar sobre el contenido: aparece tras un tiempo de interacción
 *     en la página (≥ 25 s), no antes.
 *   • Nunca para Premium. El consentimiento publicitario lo gobierna el CMP de
 *     Google (TCF) dentro del tag de AdSense (ver docs/monetizacion.md §4).
 *   • Botón de cerrar visible + `Escape`, con `role="dialog"` y `aria-modal`.
 *   • Frecuencia limitada: máximo uno por sesión y un intervalo mínimo (6 h).
 *   • Sin animaciones, por lo que respeta `prefers-reduced-motion` por defecto.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { usePremium } from '@/context/PremiumContext';
import { useConsentState } from '@/hooks/useConsentState';
import { track } from '@/lib/analytics';
import { AdBanner } from '@/components/shared/AdBanner';
import {
  adsConsentReady,
  adsEnabled,
  adsenseConfig,
  shouldShowInterstitial,
  loadAdsenseScript,
  INTERSTITIAL_INTERACTION_MS,
  INTERSTITIAL_MIN_INTERVAL_MS,
} from '@/lib/ads';

const ADS = adsenseConfig();

/** Claves de frecuencia: sesión (1 vía) e histórico (intervalo mínimo). */
const SESSION_KEY = 'rink-ad-interstitial-session';
const LAST_KEY = 'rink-ad-interstitial-last';

/** Selector de elementos tabulables dentro del diálogo modal. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** #359: índice destino al tabular dentro del diálogo (trap de foco). */
function trapFocusIndex(current: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return backwards ? (current - 1 + count) % count : (current + 1) % count;
}

export function AdInterstitial() {
  const { t } = useT();
  const { isPremium, mounted } = usePremium();
  const consent = useConsentState();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const enabled = ADS.interstitialEnabled && !!ADS.client && !!ADS.slots['interstitial'];

  // Programa la aparición tras un tiempo de interacción (nunca al cargar).
  useEffect(() => {
    if (!enabled || !mounted || !adsConsentReady(consent)) return;
    if (!adsEnabled({ client: ADS.client, premium: isPremium })) return;

    let alreadyShown = false;
    let lastShownAt: number | null = null;
    try {
      alreadyShown = window.sessionStorage.getItem(SESSION_KEY) === '1';
      const raw = window.localStorage.getItem(LAST_KEY);
      lastShownAt = raw ? Number(raw) : null;
    } catch { /* almacenamiento bloqueado: seguimos sin historial */ }

    const timer = setTimeout(() => {
      const nowMs = Date.now();
      if (!shouldShowInterstitial({
        enabled,
        premium: isPremium,
        alreadyShownThisSession: alreadyShown,
        lastShownAt,
        nowMs,
        minIntervalMs: INTERSTITIAL_MIN_INTERVAL_MS,
      })) return;

      // Marca ANTES de abrir para que un remontaje no lo duplique.
      try {
        window.sessionStorage.setItem(SESSION_KEY, '1');
        window.localStorage.setItem(LAST_KEY, String(nowMs));
      } catch { /* noop */ }

      loadAdsenseScript(ADS.client);
      setOpen(true);
      track('ad_interstitial_shown', { zone: 'interstitial' });
    }, INTERSTITIAL_INTERACTION_MS);

    return () => clearTimeout(timer);
  }, [enabled, mounted, isPremium, consent]);

  const close = useCallback(() => {
    setOpen(false);
    track('ad_interstitial_closed', { zone: 'interstitial' });
  }, []);

  // Escape para cerrar + trap de Tab + foco al diálogo + bloquear scroll de fondo.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = (document.activeElement as HTMLElement | null) ?? null;
    const root = dialogRef.current;
    const focusables = (): HTMLElement[] =>
      root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const current = active ? list.indexOf(active) : -1;
      if (current === -1) { e.preventDefault(); (list[0] ?? root)?.focus(); return; }
      const target = trapFocusIndex(current, list.length, e.shiftKey);
      if (target !== current) { e.preventDefault(); list[target]!.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    dialogRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[70] flex items-center justify-center
                 bg-slate-900/60 backdrop-blur-sm px-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('ads.interstitial_title')}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700
                   bg-white dark:bg-slate-900 shadow-2xl p-4"
      >
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          {t('ads.interstitial_title')}
        </p>

        <button
          type="button"
          onClick={close}
          aria-label={t('ads.close')}
          className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center
                     rounded-full text-slate-500 dark:text-slate-400 hover:text-slate-700 hover:bg-slate-100
                     dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
               className="h-5 w-5" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>

        <AdBanner zone="interstitial" className="mt-1" />

        <button
          type="button"
          onClick={close}
          className="mt-3 w-full min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700
                     text-sm font-semibold text-slate-700 dark:text-slate-200
                     hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          {t('ads.close')}
        </button>
      </div>
    </div>
  );
}
