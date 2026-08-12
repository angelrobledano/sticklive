'use client';

import { useT } from '@/lib/i18n';

/**
 * Enlace "saltar al contenido" (WCAG 2.4.1). Oculto hasta recibir foco por
 * teclado; al pulsarlo, salta el foco al <main id="main"> evitando tabular
 * por toda la navegación. Es el primer elemento tabulable de la página.
 */
export function SkipToContent() {
  const { t } = useT();
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-3 focus:left-3
                 focus:rounded-lg focus:bg-rink-passion focus:px-4 focus:py-2
                 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg
                 focus:outline-none focus:ring-2 focus:ring-white"
    >
      {t('a11y.skip_to_content')}
    </a>
  );
}
