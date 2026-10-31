'use client';

import { LocaleLink as Link } from '@/components/shared/LocaleLink';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';

/**
 * #336: 404 localizado, con una pista de hockey patines: la bola se ha ido por
 * encima de la valla («fuera de pista»).
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
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center gap-7 px-6 py-10 text-center">
      <RinkIllustration />

      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-rink-passion dark:text-rink-accent">
          {tt(t, 'errors.not_found_kicker', 'Error 404 · Fuera de pista')}
        </p>
        <h1 className="text-2xl font-extrabold leading-tight text-slate-900 dark:text-slate-50">
          {tt(t, 'errors.not_found_title', 'Esta bola se ha ido por encima de la valla')}
        </h1>
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          {tt(t, 'errors.not_found_body', 'La página que buscas no existe o ha cambiado de sitio. Saca de nuevo desde el centro de la pista.')}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-rink-passion px-5 text-sm font-semibold text-white transition-colors hover:bg-rink-passion-light focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion focus-visible:ring-offset-2 active:bg-rink-passion-dark dark:focus-visible:ring-rink-accent"
        >
          {tt(t, 'errors.not_found_home', 'Ver los partidos de hoy')}
        </Link>
        <Link
          href="/competitions"
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 px-5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion focus-visible:ring-offset-2 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:focus-visible:ring-rink-accent"
        >
          {tt(t, 'errors.not_found_competitions', 'Ver competiciones')}
        </Link>
        <Link
          href="/search"
          className="inline-flex min-h-[44px] items-center justify-center px-3 text-sm font-semibold text-slate-500 underline-offset-4 hover:underline dark:text-slate-400"
        >
          {tt(t, 'errors.not_found_search', 'Buscar un equipo')}
        </Link>
      </div>
    </div>
  );
}

/** Media pista desde arriba: portería, área, stick y la bola saliendo por la valla. */
function RinkIllustration() {
  return (
    <svg viewBox="0 -14 330 184" className="w-full max-w-[320px]" role="img" aria-hidden="true">
      {/* Pista */}
      <rect x="10" y="20" width="300" height="140" rx="38" className="fill-sky-50 stroke-slate-300 dark:fill-slate-800/60 dark:stroke-slate-600" strokeWidth="3" />
      {/* Línea central y círculo */}
      <line x1="160" y1="20" x2="160" y2="160" className="stroke-rink-passion/50" strokeWidth="2" />
      <circle cx="160" cy="90" r="22" fill="none" className="stroke-rink-passion/50" strokeWidth="2" />
      <circle cx="160" cy="90" r="2.5" className="fill-rink-passion/70" />
      {/* Áreas */}
      <path d="M10 62 h40 a28 28 0 0 1 0 56 h-40" fill="none" className="stroke-sky-400/70" strokeWidth="2" />
      <path d="M310 62 h-40 a28 28 0 0 0 0 56 h40" fill="none" className="stroke-sky-400/70" strokeWidth="2" />
      {/* Porterías */}
      <rect x="22" y="78" width="12" height="24" rx="2" fill="none" className="stroke-slate-500 dark:stroke-slate-300" strokeWidth="2.5" />
      <rect x="286" y="78" width="12" height="24" rx="2" fill="none" className="stroke-slate-500 dark:stroke-slate-300" strokeWidth="2.5" />
      {/* «404» en el centro: el cero es el círculo central */}
      <text x="118" y="104" textAnchor="middle" className="fill-slate-800 font-extrabold dark:fill-slate-100" fontSize="42">4</text>
      <text x="202" y="104" textAnchor="middle" className="fill-slate-800 font-extrabold dark:fill-slate-100" fontSize="42">4</text>
      {/* Stick */}
      <g className="stroke-slate-700 dark:stroke-slate-200" strokeLinecap="round">
        <line x1="214" y1="150" x2="250" y2="112" strokeWidth="4" />
        <path d="M250 112 q8 -8 16 -4" fill="none" strokeWidth="6" />
      </g>
      {/* Trayectoria y bola fuera de la pista */}
      <path d="M262 106 Q 284 40 300 -2" fill="none" className="stroke-rink-passion/60" strokeWidth="2" strokeDasharray="4 5" />
      <g>
        <circle cx="304" cy="2" r="7" className="fill-rink-passion dark:fill-rink-accent" />
        <path d="M299 0 q5 4 10 0" fill="none" stroke="white" strokeWidth="1.2" opacity="0.8" />
      </g>
    </svg>
  );
}
