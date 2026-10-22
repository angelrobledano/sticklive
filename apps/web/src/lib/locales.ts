/** Constantes de idiomas compartidas entre server (SEO/layout) y client (i18n). */

export const SUPPORTED_LOCALES = ['es', 'ca', 'en', 'pt', 'fr', 'it'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  es: 'Español', ca: 'Català', en: 'English', pt: 'Português', fr: 'Français', it: 'Italiano',
};

export const FALLBACK_LOCALE: Locale = 'es';
export const REFERENCE_LOCALE: Locale = 'es';
export const LOCALE_COOKIE = 'sticklive_locale';

export function isSupportedLocale(v: string | undefined | null): v is Locale {
  return !!v && (SUPPORTED_LOCALES as readonly string[]).includes(v);
}
