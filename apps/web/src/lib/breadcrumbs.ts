import type { Locale } from './locales';

/** Etiquetas comunes de las migas, por idioma. */
export const BREADCRUMB_LABELS: Record<Locale, { home: string; competitions: string }> = {
  es: { home: 'Inicio', competitions: 'Competiciones' },
  en: { home: 'Home', competitions: 'Competitions' },
  pt: { home: 'Início', competitions: 'Competições' },
  fr: { home: 'Accueil', competitions: 'Compétitions' },
  it: { home: 'Home', competitions: 'Competizioni' },
};

/** Un elemento visible de la miga. `href` va sin prefijo de idioma. */
export interface BreadcrumbItem {
  label: string;
  href: string;
}
