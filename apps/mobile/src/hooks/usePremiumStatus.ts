import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
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
 * sin login no hay entitlement que consultar (el anónimo ve ads). Refresco
 * on-focus: al volver del navegador tras pagar en la web, el estado nuevo
 * llega sin reiniciar la app (la compra es SOLO en la web, spec §7).
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

  return {
    premium: session?.token ? query.data?.premium : false,
    premiumLifetime: session?.token ? query.data?.premiumLifetime : false,
    isLoading: query.isPending,
    refresh: () => void qc.invalidateQueries({ queryKey: qk.premium }),
  };
}
