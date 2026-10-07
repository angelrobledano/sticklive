'use client';

import { useEffect } from 'react';
import { initPwa } from '@/lib/pwa';
import { useT } from '@/lib/i18n';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

/**
 * Monta el soporte PWA (registro de SW + captura del prompt de instalación) y,
 * desde #343, un aviso NO intrusivo cuando se pierde la conexión. El aviso es
 * una franja informativa (no bloquea la navegación ni tapa contenido
 * interactivo) que desaparece sola al recuperar la red.
 */
export function PwaSetup() {
  useEffect(() => { initPwa(); }, []);
  const online = useNetworkStatus();
  const { t } = useT();

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[80] flex items-center justify-center gap-2
                 px-4 py-1.5 bg-slate-800 dark:bg-slate-700 text-slate-50 text-xs font-medium shadow-md"
    >
      <span className="w-2 h-2 rounded-full bg-slate-50/70 shrink-0" aria-hidden="true" />
      <span className="truncate">{t('offline.banner')}</span>
      <button
        onClick={() => window.location.reload()}
        className="shrink-0 font-bold underline underline-offset-2 hover:opacity-80"
      >
        {t('offline.retry')}
      </button>
    </div>
  );
}
