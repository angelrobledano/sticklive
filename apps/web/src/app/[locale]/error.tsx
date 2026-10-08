'use client';
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { useT } from '@/lib/i18n';
import { tt } from '@/components/search/translate';
// app/error.tsx — Error Boundary global de Next.js 14
// Se activa cuando un Server Component lanza una excepción no capturada.
// reset() fuerza un re-render del segmento sin recargar la página.

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

// Icono: bola de hockey sobre patines (círculo con franja central y puntos)
function HockeyBallIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-16 h-16"
      aria-hidden="true"
    >
      {/* Cuerpo de la bola */}
      <circle cx="32" cy="32" r="30" className="fill-white dark:fill-slate-800 stroke-slate-300 dark:stroke-slate-600" strokeWidth="2" />
      {/* Franjas características */}
      <path
        d="M4 32 Q 16 22 32 32 Q 48 42 60 32"
        className="stroke-rink-passion"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M4 32 Q 16 42 32 32 Q 48 22 60 32"
        className="stroke-rink-passion"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      {/* Puntos de ventilación */}
      {[
        [22, 20], [32, 17], [42, 20],
        [22, 44], [32, 47], [42, 44],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="2.5" className="fill-slate-300 dark:fill-slate-600" />
      ))}
    </svg>
  );
}

// Icono de árbitro / silbato
function WhistleIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v4.59L7.3 13.28a.75.75 0 101.4.535l2.25-5.88v-.185z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// Icono refresh / reintentar
function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H5.498a.75.75 0 00-.75.75v3.236a.75.75 0 001.5 0v-1.73l.312.311a7 7 0 0011.713-3.138.75.75 0 10-1.461-.344zm-5.625-7.849a.75.75 0 010 1.5H7.25l.312.311A7 7 0 0118.875 8.5a.75.75 0 101.5 0 8.5 8.5 0 00-14.212-4.137l-.311-.312V2a.75.75 0 00-1.5 0v3.236c0 .414.336.75.75.75h3.236a.75.75 0 000-1.5H6.405l-.312-.311A7 7 0 019.687 3.575z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function GlobalError({ error, reset }: ErrorPageProps) {
  const { t } = useT();
  const isDev = process.env.NODE_ENV === 'development';

  // Este boundary no reportaba a Sentry (solo el global-error.tsx lo hacía):
  // los errores del árbol principal quedaban como digest sin traza (#162).
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center gap-6">
      {/* Bola de hockey */}
      <HockeyBallIcon />

      {/* Tarjeta de mensaje */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm px-6 py-5 max-w-sm w-full space-y-3">
        {/* Badge de árbitro */}
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
                        bg-rose-50 dark:bg-rose-900/20
                        text-rose-700 dark:text-rose-400
                        text-xs font-semibold tracking-wide">
          <WhistleIcon />
          <span>{tt(t, 'errors.boundary_badge', 'PARTIDO DETENIDO')}</span>
        </div>

        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100 leading-snug">
          {tt(t, 'errors.boundary_title', 'El árbitro ha detenido el partido temporalmente')}
        </h1>

        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          {tt(t, 'errors.boundary_body', 'Se ha producido un problema de conexión con el marcador. El equipo técnico ya está trabajando en ello — inténtalo de nuevo en unos segundos.')}
        </p>

        {/* Digest en desarrollo */}
        {isDev && error.message && (
          <p className="text-xs font-mono bg-slate-100 dark:bg-slate-900/60
                         text-slate-500 dark:text-slate-400
                         rounded-lg px-3 py-2 text-left break-all">
            {error.message}
            {error.digest && (
              <span className="block mt-1 text-slate-500 dark:text-slate-400">
                digest: {error.digest}
              </span>
            )}
          </p>
        )}
      </div>

      {/* Botón Reintentar */}
      <button
        onClick={reset}
        className="inline-flex items-center gap-2
                   bg-rink-passion hover:bg-rink-passion-light active:bg-rink-passion-dark
                   text-white font-semibold text-sm
                   px-5 py-2.5 rounded-xl
                   transition-colors duration-150
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-rink-passion dark:focus-visible:ring-rink-accent focus-visible:ring-offset-2"
      >
        <RefreshIcon />
        {tt(t, 'errors.retry', 'Reintentar')}
      </button>

      {/* Enlace home secundario */}
      <a
        href="/"
        className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300
                   underline underline-offset-2 transition-colors"
      >
        {tt(t, 'errors.not_found_home', 'Volver al inicio')}
      </a>
    </div>
  );
}
