'use client';

import { useEffect, useState } from 'react';
import { CONSENT_EVENT, CONSENT_KEY, readConsent, type ConsentState } from '@/lib/consent';

/**
 * Estado de consentimiento de analítica en cliente.
 *
 * `null` antes de montar (SSR y primer render), para no decidir con una lectura
 * de `localStorage` que el servidor no puede hacer. Después refleja el valor
 * guardado y se mantiene al día si otra pestaña lo cambia.
 */
export function useConsentState(): ConsentState | null {
  const [state, setState] = useState<ConsentState | null>(null);

  useEffect(() => {
    const sync = () => setState(readConsent());
    sync();

    const onStorage = (e: StorageEvent) => {
      if (e.key === CONSENT_KEY || e.key === null) sync();
    };
    window.addEventListener(CONSENT_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CONSENT_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return state;
}
