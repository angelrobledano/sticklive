'use client';

/**
 * Sistema i18n de Stick Live — ligero, sin dependencias.
 *
 * · El idioma activo lo fija la URL (/es/..., /en/...): el layout del
 *   segmento [locale] lo inyecta vía initialLocale.
 * · setLocale navega a la misma ruta con el nuevo prefijo y persiste la
 *   elección (cookie para el middleware + localStorage como respaldo).
 * · Interpolación: t('favorites.toast_following', { name: 'Barça' }).
 * · Fallback de clave: si falta una traducción, se usa la cadena en español
 *   (idioma de referencia del producto) y, en último término, la propia clave.
 */

import { createContext, useCallback, useContext, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import es from '@/locales/es.json';
import en from '@/locales/en.json';
import pt from '@/locales/pt.json';
import fr from '@/locales/fr.json';
import it from '@/locales/it.json';
import {
  SUPPORTED_LOCALES, LOCALE_NAMES, REFERENCE_LOCALE, LOCALE_COOKIE,
  isSupportedLocale, type Locale,
} from '@/lib/locales';
import { track, setPersonProps } from '@/lib/analytics';

export { SUPPORTED_LOCALES, LOCALE_NAMES };
export type { Locale };

const STORAGE_KEY = LOCALE_COOKIE;
const REFERENCE: Locale = REFERENCE_LOCALE;

type Dict = Record<string, unknown>;
const DICTS: Record<Locale, Dict> = { es, en, pt, fr, it };

function lookup(dict: Dict, path: string): string | undefined {
  let node: unknown = dict;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Dict)[key];
  }
  return typeof node === 'string' ? node : undefined;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: REFERENCE,
  setLocale: () => undefined,
  t: (key) => lookup(DICTS[REFERENCE], key) ?? key,
});

export function I18nProvider({ children, initialLocale }: {
  children: React.ReactNode;
  initialLocale: Locale;
}) {
  const locale: Locale = isSupportedLocale(initialLocale) ? initialLocale : REFERENCE;
  const router = useRouter();
  const pathname = usePathname();

  // SEO/a11y: sincronizar <html lang> con el idioma activo
  useEffect(() => {
    try { document.documentElement.lang = locale; } catch { /* noop */ }
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    if (!isSupportedLocale(l) || l === locale) return;
    track('locale_changed', { from: locale, to: l });
    setPersonProps({ locale: l });
    try {
      localStorage.setItem(STORAGE_KEY, l);
      // Cookie para que el middleware respete la elección en futuras visitas
      document.cookie = `${LOCALE_COOKIE}=${l};path=/;max-age=31536000;samesite=lax`;
    } catch { /* noop */ }

    // Misma ruta, nuevo prefijo de idioma
    const parts = (pathname ?? '/').split('/');
    if (isSupportedLocale(parts[1])) {
      parts[1] = l;
      router.push(parts.join('/') || `/${l}`);
    } else {
      router.push(`/${l}${pathname ?? ''}`);
    }
  }, [locale, pathname, router]);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    let text = lookup(DICTS[locale], key) ?? lookup(DICTS[REFERENCE], key) ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
    }
    return text;
  }, [locale]);

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext);
}
