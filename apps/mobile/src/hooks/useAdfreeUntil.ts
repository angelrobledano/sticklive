import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { getAdfreeUntil } from '@/src/lib/ads/adfree';

/**
 * Estado reactivo del ad-free recompensado (Plan D): lee `ads.adfree_until`
 * del storage al montar Y en cada foco.
 *
 * El foco NO es lujo: la concesión ocurre en la pantalla premium (otro punto
 * del árbol) y las pantallas que consumen este hook permanecen montadas
 * (tabs/stack) — sin releer al volver, un banner ya visible seguiría
 * mostrándose durante el adfree que el usuario acaba de pagar con su tiempo
 * (y el native in-feed de la Task 6 hereda el mismo riesgo si copiara la
 * lectura "solo mount" a mano).
 */
export function useAdfreeUntil(): number | null {
  const [adfreeUntil, setAdfreeUntil] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void getAdfreeUntil().then((ts) => {
        if (!cancelled) setAdfreeUntil(ts);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return adfreeUntil;
}
