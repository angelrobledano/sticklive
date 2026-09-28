'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { CONSENT_KEY, emitConsentChange, readConsent, writeConsent, type ConsentState } from '@/lib/consent';

/**
 * Aviso de consentimiento de analítica (RGPD/ePrivacy). No bloquea la app:
 * aparece solo si todavía no hay una elección guardada y delega en
 * `lib/consent.ts` la persistencia. Aceptar dispara la inicialización de
 * PostHog (vía `CONSENT_EVENT`, escuchado en `AnalyticsPageview`); rechazar
 * deja la analítica como no-op sin crear ninguna cookie/persistencia.
 *
 * Montado una sola vez en el layout raíz.
 */
export function ConsentBanner() {
  const { t } = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Leer en un efecto (no en el render) evita desajustes de hidratación:
    // el HTML estático no conoce localStorage.
    const sync = () => setVisible(readConsent() === 'pending');
    sync();
    // Si se decide en otra pestaña, ocultar/mostrar aquí también.
    const onStorage = (e: StorageEvent) => {
      if (e.key === CONSENT_KEY || e.key === null) sync();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const decide = (state: Exclude<ConsentState, 'pending'>) => {
    writeConsent(state);
    emitConsentChange();
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label={t('consent.title')}
      className="fixed left-0 right-0 bottom-20 md:bottom-4 z-[60] px-3"
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
