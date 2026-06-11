'use client';
/**
 * PremiumContext — Estado global de suscripción Premium.
 *
 * Por qué un Context y no solo localStorage:
 *   Al volver de /premium/success con navegación client-side de Next.js,
 *   los componentes <AdBanner> ya montados NO re-ejecutan useEffect. Con
 *   un Context, llamar setPremium(true) en cualquier punto del árbol
 *   provoca un re-render en todos los consumidores de forma inmediata y
 *   sincrónica, sin recarga ni reinicio de la app.
 *
 * Flujo de hidratación:
 *   1. Servidor renderiza sin conocer el estado → isPremium = false.
 *   2. useEffect en el Provider lee localStorage y hace setPremium si procede.
 *   3. Todos los <AdBanner> ya montados reciben el update → desaparecen.
 *   El flash es imperceptible porque ocurre antes del primer frame visible
 *   cuando la página ya tiene TTI bajo.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';

const PREMIUM_KEY = 'rink-is-premium';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface PremiumContextValue {
  /** true si el dispositivo tiene suscripción Premium activa */
  isPremium: boolean;
  /** Actualiza el estado en memoria Y en localStorage */
  setPremium: (value: boolean) => void;
  /** false hasta que el cliente haya leído localStorage (evita hydration mismatch) */
  mounted: boolean;
}

// ─── Contexto ─────────────────────────────────────────────────────────────────

const PremiumContext = createContext<PremiumContextValue>({
  isPremium: false,
  setPremium: () => undefined,
  mounted: false,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function PremiumProvider({ children }: { children: ReactNode }) {
  const [isPremium, setIsPremium] = useState(false);
  const [mounted,   setMounted]   = useState(false);

  // Leer localStorage en el cliente (una sola vez)
  useEffect(() => {
    setMounted(true);
    try {
      if (localStorage.getItem(PREMIUM_KEY) === 'true') {
        setIsPremium(true);
      }
    } catch { /* SSR / iframe privado */ }
  }, []);

  const setPremium = useCallback((value: boolean) => {
    setIsPremium(value);
    try {
      localStorage.setItem(PREMIUM_KEY, value ? 'true' : 'false');
    } catch { /* noop */ }
  }, []);

  return (
    <PremiumContext.Provider value={{ isPremium, setPremium, mounted }}>
      {children}
    </PremiumContext.Provider>
  );
}

// ─── Hook público ─────────────────────────────────────────────────────────────

/**
 * Hook para consumir el estado Premium desde cualquier Client Component.
 * Si `mounted` es false, el componente aún está en SSR/hydration —
 * en ese caso los banners NO deben renderizarse para evitar hydration mismatch.
 */
export function usePremium(): PremiumContextValue {
  return useContext(PremiumContext);
}
