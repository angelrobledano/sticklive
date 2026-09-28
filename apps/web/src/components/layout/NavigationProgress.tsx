'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';
import {
  IDLE,
  PENDING_DELAY_MS,
  PENDING_TIMEOUT_MS,
  reducePending,
  shouldRenderPending,
  shouldStartPending,
} from '@/lib/navigation-pending';

/**
 * #345: barra global de "navegación en curso" para que el usuario no perciba
 * "no responde" al pulsar una tarjeta con la API lenta.
 *
 * Por qué NO se resuelve con `loading.tsx`: esos ficheros crean un límite de
 * Suspense de ruta, el fallback se streamea con 200 y `notFound()` ya no puede
 * fijar el 404 real (#168). Este indicador vive SOLO en el cliente (un div
 * fijo); no envuelve el segmento, no cambia el status HTTP y no afecta al
 * render del Server Component. La decisión pura de cuándo encenderse/apagarse
 * está en `@/lib/navigation-pending` (testeada sin navegador).
 *
 * Se monta desde `BottomNav`, el único componente cliente que `layout.tsx`
 * renderiza en TODAS las páginas (no se tocó `layout.tsx`).
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const { t } = useT();
  const [state, dispatch] = useReducer(reducePending, IDLE);
  // Reloj de render: se actualiza al cumplirse PENDING_DELAY_MS para que
  // `shouldRenderPending` decida si ya toca pintar (evita el flash).
  const [clock, setClock] = useState(0);
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (delayRef.current !== null) {
      clearTimeout(delayRef.current);
      delayRef.current = null;
    }
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Captura global de clicks en enlaces internos → enciende el indicador.
  // Fase de captura para registrar la intención antes de que navegue el router.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;

      const starts = shouldStartPending({
        href: anchor.getAttribute('href') ?? '',
        target: anchor.getAttribute('target'),
        download: anchor.hasAttribute('download'),
        modifier: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
        button: event.button,
        origin: window.location.origin,
        currentHref: window.location.href,
      });
      if (!starts) return;

      dispatch({ type: 'start', url: anchor.href, at: Date.now() });
      setClock(0);
      clearTimers();
      delayRef.current = setTimeout(() => setClock(Date.now()), PENDING_DELAY_MS);
      // Red de seguridad: nunca dejar la barra colgada si la navegación no termina.
      timeoutRef.current = setTimeout(() => {
        dispatch({ type: 'timeout' });
        clearTimers();
      }, PENDING_TIMEOUT_MS);
    };

    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      clearTimers();
    };
  }, [clearTimers]);

  // La ruta destino llegó (cambió el pathname) → apaga el indicador.
  useEffect(() => {
    dispatch({ type: 'settle' });
    setClock(0);
    clearTimers();
  }, [pathname, clearTimers]);

  if (!shouldRenderPending(state, clock)) return null;

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-0 z-[60]">
      <span className="sr-only">{tt(t, 'a11y.navigating', 'Cargando…')}</span>
      <div
        aria-hidden="true"
        className="h-0.5 w-full bg-rink-passion/70 animate-pulse motion-reduce:animate-none"
      />
    </div>
  );
}
