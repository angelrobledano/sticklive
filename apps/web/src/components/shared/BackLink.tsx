'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useT } from '@/lib/i18n';
import { withLocaleHref } from '@/lib/locale-links';
import { shouldReturnToHistory } from '@/lib/back-link';

/**
 * Botón Volver — táctil (44px), flecha en acento, etiqueta i18n.
 *
 * Vuelve a la página anterior EXACTA (mantiene el día seleccionado, los filtros
 * de la competición, etc.) en vez de a una ruta fija. Si se entró directo (deep
 * link compartido, sin historial dentro de la app), usa el `href` de respaldo.
 */
export function BackLink({ href = '/' }: { href?: string }) {
  const { t } = useT();
  const router = useRouter();
  const locale = useLocale();

  const onBack = () => {
    if (typeof window !== 'undefined' && shouldReturnToHistory(document.referrer, window.location.origin)) {
      router.back();
    } else {
      router.push(withLocaleHref(href, locale));
    }
  };

  return (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300
                 -ml-2 px-2 min-h-[44px] rounded-lg transition-colors
                 hover:bg-slate-100 dark:hover:bg-slate-800 active:bg-slate-100"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-5 h-5 text-rink-passion">
        <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {t('navigation.back')}
    </button>
  );
}
