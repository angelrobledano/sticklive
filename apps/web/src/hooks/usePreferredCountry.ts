'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSession } from '@/hooks/useAuth';
import { isCountryCode, suggestCountry } from '@/lib/country-pref';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';
const KEY = 'sl_country';
const EVENT = 'sl-country-changed';
/** «Todos los países» elegido a propósito: no debe caer a la sugerencia. */
export const ALL_COUNTRIES = 'ALL';

/** Países con competiciones hoy. Se amplía al añadir países (no condiciona nada más). */
export const HOME_COUNTRIES = ['ES', 'PT', 'IT'] as const;

export interface PreferredCountry {
  /** País con el que se ordena la home (elegido o sugerido), o null. */
  country: string | null;
  /** true si lo eligió el usuario; false si es la sugerencia por región. */
  chosen: boolean;
  setCountry: (c: string | null) => void;
}

/**
 * Elección guardada: código de país, `ALL_COUNTRIES` si eligió «Todos los
 * países», o null si nunca eligió (entonces se sugiere por el navegador).
 */
export function readChosen(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === ALL_COUNTRIES || isCountryCode(v) ? v : null;
  } catch { return null; }
}

/** País efectivo: «Todos» elegido gana a la sugerencia del navegador. */
export function resolveCountry(chosen: string | null, suggested: string | null): string | null {
  if (chosen === ALL_COUNTRIES) return null;
  return chosen ?? suggested;
}

/**
 * País preferido (plan 2026-10-25, iteración 4). Canónico en localStorage
 * (funciona anónimo); con sesión se sincroniza con `/auth/preferences`. Sin
 * elección, se sugiere por la región del navegador sin guardarlo.
 */
export function usePreferredCountry(): PreferredCountry {
  const [chosen, setChosen] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setChosen(readChosen());
    refresh();
    try { setSuggested(suggestCountry(navigator.languages ?? [navigator.language], HOME_COUNTRIES)); } catch { /* noop */ }
    window.addEventListener(EVENT, refresh);
    window.addEventListener('storage', refresh);

    // Con sesión y sin elección local, se adopta la de la cuenta.
    const session = getSession();
    if (session && !readChosen()) {
      fetch(`${API_URL}/auth/preferences`, { headers: { Authorization: `Bearer ${session}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { country?: unknown } | null) => {
          if (j && isCountryCode(j.country) && !readChosen()) {
            try { localStorage.setItem(KEY, j.country); } catch { /* noop */ }
            refresh();
          }
        })
        .catch(() => { /* sin red: se queda la local */ });
    }
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const setCountry = useCallback((c: string | null) => {
    try {
      localStorage.setItem(KEY, c && isCountryCode(c) ? c : ALL_COUNTRIES);
      window.dispatchEvent(new Event(EVENT));
    } catch { /* noop */ }
    const session = getSession();
    if (session) {
      void fetch(`${API_URL}/auth/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
        body: JSON.stringify({ country: c && isCountryCode(c) ? c : null }),
      }).catch(() => { /* se reintenta al volver a elegir */ });
    }
  }, []);

  return { country: resolveCountry(chosen, suggested), chosen: chosen !== null, setCountry };
}
