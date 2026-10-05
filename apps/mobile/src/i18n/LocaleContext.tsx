import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { dictionaries, LOCALES, resolveKey, type Locale } from './locales';

interface LocaleCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const Ctx = createContext<LocaleCtx | null>(null);
const STORAGE_KEY = 'sticklive.locale';

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('es');

  useEffect(() => {
    // Carrera teórica: un cambio de idioma previo a la resolución de getItem sería sobreescrito por el valor guardado (no alcanzable en la práctica).
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved && LOCALES.includes(saved as Locale)) setLocaleState(saved as Locale);
    }).catch(() => {}); // Fallo de persistencia de preferencia → fallback al idioma por defecto; no es dato de negocio (regla de explicitud aplica a la ingesta, no a prefs de UI).
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    void AsyncStorage.setItem(STORAGE_KEY, l);
  }, []);

  const t = useCallback(
    (key: string) => resolveKey(dictionaries[locale], key),
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocale(): LocaleCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLocale fuera de LocaleProvider');
  return ctx;
}
