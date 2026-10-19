'use client';

import { useEffect, useState } from 'react';
import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useT } from '@/lib/i18n';
import {
  FALLBACK_CONSENT_REQUEST_EVENT,
  readFallbackConsent,
  subscribeFallbackConsent,
  writeFallbackConsent,
} from '@/lib/consent-fallback';
import {
  getAnalyticsConsentState,
  probeCmpDisplayStatus,
  subscribeAnalyticsConsent,
} from '@/lib/consent-tcf';

/** Margen para que el CMP de Google cargue y muestre su mensaje. */
const FALLBACK_DELAY_MS = 7_000;
const CHECK_INTERVAL_MS = 1_500;

/**
 * Aviso de analítica de respaldo.
 *
 * La puerta principal es el CMP de Google. Este aviso solo aparece si, pasados
 * unos segundos, el CMP sigue sin mensaje visible y sin una decisión (por
 * ejemplo, porque el mensaje GDPR no está publicado en AdSense o un bloqueador
 * impide cargarlo). Así la analítica no se queda bloqueada para siempre y el
 * usuario conserva una forma de aceptar o rechazar.
 *
 * Si el CMP está visible o ya hay una decisión suya, este aviso no se muestra.
 */
export function FallbackConsentBanner() {
  const { t } = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let busy = false;
    const startedAt = Date.now();

    const evaluate = async (force = false) => {
      if (cancelled || busy) return;
      if (!force && Date.now() - startedAt < FALLBACK_DELAY_MS) return;
      busy = true;
      try {
        if (getAnalyticsConsentState() !== 'pending') {
          setVisible(false);
          return;
        }
        if (readFallbackConsent() !== 'pending') {
          setVisible(false);
          return;
        }
        const display = await probeCmpDisplayStatus();
        if (cancelled) return;
        // Si Google está mostrando su mensaje, no lo tapamos.
        setVisible(display !== 'visible');
      } finally {
        busy = false;
      }
    };

    const onRequest = () => {
      setVisible(false);
      void evaluate(true);
    };
    const timer = setTimeout(() => void evaluate(), FALLBACK_DELAY_MS);
    const interval = setInterval(() => void evaluate(), CHECK_INTERVAL_MS);
    const unsubscribeTcf = subscribeAnalyticsConsent(() => void evaluate());
    const unsubscribeFallback = subscribeFallbackConsent(() => void evaluate());
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void evaluate();
    };

    window.addEventListener(FALLBACK_CONSENT_REQUEST_EVENT, onRequest);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(interval);
      unsubscribeTcf();
      unsubscribeFallback();
      window.removeEventListener(FALLBACK_CONSENT_REQUEST_EVENT, onRequest);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const decide = (state: 'granted' | 'denied') => {
    writeFallbackConsent(state);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label={t('consent.title')}
      className="consent-banner fixed left-0 right-0 bottom-20 md:bottom-4 z-[60] px-3"
    >
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-700
                      bg-white dark:bg-slate-900 shadow-2xl p-4 space-y-3">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {t('consent.title')}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          {t('consent.body')}{' '}
          <Link href="/privacy" className="underline hover:text-slate-700 dark:hover:text-slate-200">
            {t('consent.privacy')}
          </Link>
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => decide('granted')}
            className="flex-1 min-h-[44px] rounded-xl bg-rink-passion text-white text-sm font-semibold
                       hover:opacity-90 transition-opacity"
          >
            {t('consent.accept')}
          </button>
          <button
            onClick={() => decide('denied')}
            className="flex-1 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700
                       text-sm font-semibold text-slate-700 dark:text-slate-200
                       hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            {t('consent.reject')}
          </button>
        </div>
      </div>
    </div>
  );
}
