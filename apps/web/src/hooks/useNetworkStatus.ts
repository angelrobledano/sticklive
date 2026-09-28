'use client';

import { useEffect, useState } from 'react';

/**
 * #343 — Detección de red para la capacidad offline/PWA.
 *
 * `navigator.onLine` es un indicador conservador (puede dar `true` con cobertura
 * engañosa), pero es la señal estándar junto a los eventos `online`/`offline`.
 * El uso es no intrusivo: solo avisamos cuando el navegador declara estar sin
 * conexión, sin bloquear la navegación ni asumir que una petición fallará.
 */

/**
 * Normaliza el estado de red: SOLO `false` explícito cuenta como offline.
 * `true`, `undefined` y `null` se tratan como online para que el render del
 * servidor (sin `navigator`) no muestre el aviso antes de hidratar.
 */
export function resolveNetworkStatus(online: boolean | undefined | null): boolean {
  return online !== false;
}

/** ¿El navegador declara estar online ahora mismo? (SSR-safe → true). */
export function currentNetworkStatus(): boolean {
  if (typeof navigator === 'undefined') return true;
  return resolveNetworkStatus(navigator.onLine);
}

/**
 * Estado de conexión reactivo: se actualiza con `online`/`offline`.
 * Devuelve `true` mientras no se sepa lo contrario (evita falsos avisos en SSR).
 */
export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(currentNetworkStatus());
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  return online;
}
