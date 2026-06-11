'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePremium } from '@/context/PremiumContext';

export default function PremiumSuccessPage() {
  const { setPremium } = usePremium();

  useEffect(() => {
    // Mutación instantánea en caliente:
    // setPremium actualiza el Context → todos los <AdBanner> del árbol
    // reciben el cambio de estado y devuelven null sin recarga.
    // También persiste en localStorage para sesiones futuras.
    setPremium(true);
  }, [setPremium]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center gap-5">
      {/* Icono corona */}
      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-400 to-amber-500
                      flex items-center justify-center shadow-lg">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 text-white">
          <path d="M12 2L9 9 2 9l5.5 4-2 7L12 16l6.5 4-2-7L22 9l-7 0z" />
        </svg>
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-50">
          ¡Ya eres Premium!
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
          Tu pago se ha procesado correctamente. Disfruta de la app sin publicidad
          y con todas las notificaciones en tiempo real.
        </p>
      </div>

      <Link
        href="/"
        className="inline-flex items-center gap-2 bg-rink-passion hover:bg-red-700
                   text-white font-semibold text-sm px-5 py-2.5 rounded-xl
                   transition-colors focus:outline-none focus-visible:ring-2
                   focus-visible:ring-rink-passion focus-visible:ring-offset-2"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path fillRule="evenodd" d="M9.293 2.293a1 1 0 011.414 0l7 7A1 1 0 0117 11h-1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-3a1 1 0 00-1-1H9a1 1 0 00-1 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-6H3a1 1 0 01-.707-1.707l7-7z" clipRule="evenodd" />
        </svg>
        Ver la app sin anuncios
      </Link>
    </div>
  );
}
