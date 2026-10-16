'use client';

/**
 * Sistema i18n de Stick Live — ligero, sin dependencias.
 *
 * · El idioma activo lo fija la URL (/es/..., /en/...): el layout del
 *   segmento [locale] inyecta el locale y el diccionario vía props (solo el
 *   diccionario activo + el de referencia viajan al cliente, #366).
 * · setLocale navega a la misma ruta con el nuevo prefijo y persiste la
 *   elección (cookie para el middleware + localStorage como respaldo).
 * · Interpolación: t('favorites.toast_following', { name: 'Barça' }).
 * · Fallback de clave: si falta una traducción, se usa la cadena en español
 *   (idioma de referencia del producto) y, en último término, la propia clave.
 */

import { createContext, useCallback, useContext, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  SUPPORTED_LOCALES, LOCALE_NAMES, REFERENCE_LOCALE, LOCALE_COOKIE,
  isSupportedLocale, type Locale,
} from '@/lib/locales';
import { track, setPersonProps } from '@/lib/analytics';

export { SUPPORTED_LOCALES, LOCALE_NAMES };
export type { Locale };

const STORAGE_KEY = LOCALE_COOKIE;
const REFERENCE: Locale = REFERENCE_LOCALE;

export type Dict = Record<string, unknown>;

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
  t: (key) => key,
});

export function I18nProvider({ children, initialLocale, dict, referenceDict }: {
  children: React.ReactNode;
  initialLocale: Locale;
  /** Diccionario del locale activo — lo pasa el layout servidor (#366). */
  dict: Dict;
  /** Diccionario de referencia (es) para el fallback de claves. */
  referenceDict: Dict;
}) {
  const locale: Locale = isSupportedLocale(initialLocale) ? initialLocale : REFERENCE;
  const router = useRouter();
  const pathname = usePathname();

  // SEO/a11y: sincronizar <html lang> con el idioma activo
  useEffect(() => {
    try { document.documentElement.lang = locale; } catch { /* noop */ }
  }, [locale]);

  // #363: persistir el locale activo en la cookie aunque el usuario no cambie
  // de idioma a mano. Sin ella, el start_url "/" de la PWA vuelve a negociar
  // por Accept-Language y puede abrir en un idioma distinto al que se estaba usando.
  useEffect(() => {
    try {
      document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=31536000;samesite=lax`;
    } catch { /* noop */ }
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
    let text = lookup(dict, key) ?? lookup(referenceDict, key) ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
    }
    return text;
  }, [dict, referenceDict]);

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext);
}

/**
 * Locale activo (el de la URL) en componentes de cliente.
 *
 * Para construir enlaces internos con el prefijo de idioma hay `LocaleLink`
 * (`components/shared/LocaleLink`): los `href` sin prefijo pasan por el
 * middleware (307) y, para Googlebot, siempre acaban en `/en` — ver SEO-01 de
 * `docs/AUDITORIA_SEO_2026-10-16.md`.
 */
export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}
