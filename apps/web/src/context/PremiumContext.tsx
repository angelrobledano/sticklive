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
  useRef,
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
  // Momento del último premium concedido tras verificación server-side (#252).
  const verifiedGrantAt = useRef(0);

  // 1) localStorage como caché optimista (evita parpadeo). 2) el servidor manda:
  // se consulta el estado real (premium_until > NOW()) para que el premium
  // CADUQUE de verdad en el cliente (auditoría S9), no solo en BD.
  useEffect(() => {
    setMounted(true);
    let deviceId = '';
    try {
      if (localStorage.getItem(PREMIUM_KEY) === 'true') setIsPremium(true);
      deviceId = localStorage.getItem('rink-device-id') ?? '';
    } catch { /* SSR / iframe privado */ }

    if (!deviceId) return;
    const startedAt = Date.now();
    const apiUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';
    fetch(`${apiUrl}/payments/stripe/status?deviceId=${encodeURIComponent(deviceId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { premium?: boolean } | null) => {
        if (data && typeof data.premium === 'boolean') {
          // No degradar un premium ya verificado por sesión (#252): el webhook
          // puede llegar con retraso y /status devolvería false antes de tiempo.
          if (data.premium === false && verifiedGrantAt.current > startedAt) return;
          setIsPremium(data.premium);
          try { localStorage.setItem(PREMIUM_KEY, data.premium ? 'true' : 'false'); } catch { /* noop */ }
        }
      })
      .catch(() => { /* sin red: nos quedamos con la caché local */ });
  }, []);

  const setPremium = useCallback((value: boolean) => {
    // true solo se invoca tras confirmar el pago server-side (#252).
    if (value) verifiedGrantAt.current = Date.now();
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
