import { useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/src/context/AuthContext';
import { apiFetch } from '@/src/lib/api/client';
import { isCountryCode, suggestCountry } from '@/src/lib/country-pref';
import type { UserPreferencesResponse } from '@sports/core/api';

const STORAGE_KEY = 'sticklive.preferred_country';
export const HOME_COUNTRIES = ['ES', 'PT', 'IT'] as const;
export type HomeCountry = (typeof HOME_COUNTRIES)[number];

export interface PreferredCountryState {
  country: string | null;
  chosen: boolean;
  setCountry: (c: string | null) => void;
}

interface StoredPref {
  country: string | null;
  chosen: boolean;
}

function resolveDeviceSuggestion(): string | null {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return suggestCountry([locale], HOME_COUNTRIES);
  } catch {
    return null;
  }
}

export function usePreferredCountry(): PreferredCountryState {
  const { session } = useSession();
  const queryClient = useQueryClient();

  const queryKey = ['preferred-country', session?.email ?? 'anon'];

  const { data } = useQuery<StoredPref>({
    queryKey,
    queryFn: async () => {
      // 1. Intentar leer del almacenamiento local
      try {
        const local = await AsyncStorage.getItem(STORAGE_KEY);
        if (local !== null && isCountryCode(local)) {
          return { country: local, chosen: true };
        }
        if (local === '__NONE__') {
          return { country: null, chosen: true };
        }
      } catch {
        // Fallback si falla AsyncStorage
      }

      // 2. Si hay sesión y no había elección local, consultar API
      if (session?.token) {
        try {
          const remote = await apiFetch<UserPreferencesResponse>('/auth/preferences', {
            token: session.token,
          });
          if (remote?.country && isCountryCode(remote.country)) {
            await AsyncStorage.setItem(STORAGE_KEY, remote.country).catch(() => {});
            return { country: remote.country, chosen: true };
          }
        } catch {
          // Sin red o endpoint no disponible
        }
      }

      // 3. Si no hay elección explícita, sugerir por región del dispositivo
      const suggested = resolveDeviceSuggestion();
      return { country: suggested, chosen: false };
    },
    staleTime: 1000 * 60 * 30, // 30 minutos
  });

  const mutation = useMutation({
    mutationFn: async (newCountry: string | null) => {
      // Guardar en AsyncStorage
      try {
        if (newCountry && isCountryCode(newCountry)) {
          await AsyncStorage.setItem(STORAGE_KEY, newCountry);
        } else {
          await AsyncStorage.setItem(STORAGE_KEY, '__NONE__');
        }
      } catch {
        // Ignore storage write failure
      }

      // Sincronizar con backend si está autenticado
      if (session?.token) {
        try {
          await apiFetch('/auth/preferences', {
            method: 'PUT',
            token: session.token,
            body: { country: newCountry && isCountryCode(newCountry) ? newCountry : null },
          });
        } catch {
          // Fallo de sincronización con servidor; se conserva en local
        }
      }

      return { country: newCountry, chosen: true };
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey, updated);
      // Invalidar todas las queries de preferred-country para reflejarlo globalmente
      void queryClient.invalidateQueries({ queryKey: ['preferred-country'] });
    },
  });

  const setCountry = useCallback(
    (c: string | null) => {
      mutation.mutate(c);
    },
    [mutation],
  );

  return {
    country: data?.country ?? null,
    chosen: data?.chosen ?? false,
    setCountry,
  };
}
