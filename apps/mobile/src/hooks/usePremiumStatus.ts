import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchPremiumStatus, qk } from './queries';
import { useSession } from '@/src/context/AuthContext';

export interface UsePremiumStatusResult {
  /**
   * boolean | undefined: `undefined` = cargando o error CON sesión → el guard
   * shouldShowAds hace fail-closed (nunca banner ante desconocido). `false`
   * solo sin sesión (el anónimo sí ve ads). NUNCA colapsar undefined a false:
   * un premium vería un flash de banner (spec §7: premium ⇒ cero SDK).
   */
  premium: boolean | undefined;
  premiumLifetime: boolean | undefined;
  isLoading: boolean;
  refresh: () => void;
}

/**
 * Estado premium de la SESIÓN (GET /payments/status). enabled solo con sesión:
 * sin login no hay entitlement que consultar (el anónimo ve ads). Doble
 * revalidación (la compra es SOLO en la web, spec §7):
 *  · useFocusEffect — navegación entre pantallas/pestañas in-app.
 *  · AppState 'active' — volver de segundo plano: del navegador del sistema
 *    tras pagar NO se pasa por blur in-app, así que el foco no se dispara.
 */
export function usePremiumStatus(): UsePremiumStatusResult {
  const { session } = useSession();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: qk.premium,
    queryFn: () => fetchPremiumStatus(session!.token),
    enabled: Boolean(session?.token),
    staleTime: 5 * 60_000,
  });

  useFocusEffect(
    useCallback(() => {
      if (session?.token) void qc.invalidateQueries({ queryKey: qk.premium });
    }, [session?.token, qc])
  );

  useEffect(() => {
    if (!session?.token) return;
    // Al volver de segundo plano (p. ej. del navegador tras pagar en la web),
    // el estado premium puede haber cambiado: revalidar. useFocusEffect NO
    // basta — volver del navegador no pasa por blur in-app.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void qc.invalidateQueries({ queryKey: qk.premium });
    });
    return () => sub.remove();
  }, [session?.token, qc]);

  return {
    premium: session?.token ? query.data?.premium : false,
    premiumLifetime: session?.token ? query.data?.premiumLifetime : false,
    isLoading: query.isPending,
    refresh: () => void qc.invalidateQueries({ queryKey: qk.premium }),
  };
}
