'use client';

import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';

/**
 * #336: 404 localizado.
 *
 * `notFound()` (partidos/equipos/jugadores con id inexistente, rutas
 * desconocidas bajo un locale válido) renderiza esto DENTRO del layout de
 * `[locale]`, así que el usuario conserva Sidebar/BottomNav y tiene una salida
 * clara en su idioma.
 *
 * Importante (SEO/status): este fichero NO cambia el status del 404. Seguimos
 * devolviendo 404 real porque el segmento `[locale]` NO tiene `loading.tsx`:
 * sin streaming, Next puede fijar el código 404. No añadas `loading.tsx` aquí.
 */
export default function LocaleNotFound() {
  const { t } = useT();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-6">
      {/* Icono: portería con balón fuera (404) */}
      <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
             className="w-8 h-8 text-slate-500 dark:text-slate-400" aria-hidden="true">
          <path d="M4 4h16v14H4z" strokeLinejoin="round" />
          <path d="M4 8h16M4 12h16M8 4v14M12 4v14M16 4v14" strokeWidth={0.7} />
          <circle cx="19" cy="19" r="3" className="text-rink-passion" />
        </svg>
      </div>

      <div className="space-y-2 max-w-sm">
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100 leading-snug">
          {tt(t, 'errors.not_found_title', 'Página no encontrada')}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          {tt(t, 'errors.not_found_body', 'No hemos encontrado esta página. Puede que el enlace esté roto o que ya no exista.')}
        </p>
      </div>

      {/* Salidas: primaria a la home, secundaria a competiciones */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-1.5 px-5 min-h-[44px] rounded-xl
                     text-sm font-semibold bg-rink-passion text-white
                     hover:bg-rink-passion-light active:bg-rink-passion-dark transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent focus-visible:ring-offset-2"
        >
          {tt(t, 'errors.not_found_home', 'Volver al inicio')}
        </Link>
        <Link
          href="/competitions"
          className="inline-flex items-center justify-center px-5 min-h-[44px] rounded-xl
                     text-sm font-semibold text-slate-600 dark:text-slate-300
                     border border-slate-200 dark:border-slate-700
                     hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent focus-visible:ring-offset-2"
        >
          {tt(t, 'errors.not_found_competitions', 'Ver competiciones')}
        </Link>
      </div>
    </div>
  );
}
