import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'nativewind';

export type ThemePref = 'system' | 'light' | 'dark';

interface ThemeCtx {
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);
const STORAGE_KEY = 'sticklive.theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { setColorScheme } = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>('system');

  useEffect(() => {
    // Fallo de persistencia → degrada grácilmente a 'system'; no es dato de negocio (la regla de explicitud aplica a la ingesta, no a prefs de UI).
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') setPrefState(saved);
    }).catch(() => {});
  }, []);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    void AsyncStorage.setItem(STORAGE_KEY, p);
    // nativewind 4.2.7 acepta 'system' explícito (undefined NO es válido en su firma).
    setColorScheme(p);
  }, [setColorScheme]);

  const value = useMemo(() => ({ pref, setPref }), [pref, setPref]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThemePref(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useThemePref fuera de ThemeProvider');
  return ctx;
}
