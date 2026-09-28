'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { usePremium } from '@/context/PremiumContext';
import { track } from '@/lib/analytics';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

type Verification = 'verifying' | 'granted' | 'pending' | 'error';

/**
 * Página de retorno de Stripe Checkout (#252).
 *
 * IMPORTANTE: llegar aquí NO concede premium. Antes se llamaba a
 * `setPremium(true)` incondicionalmente, lo que regalaba el entitlement y
 * falsificaba la analítica de compra. Ahora se verifica server-side el
 * `session_id` contra Stripe; el webhook sigue siendo la fuente de verdad
 * de la BD y el premium caduca por `premium_until`.
 */
function PremiumSuccessInner() {
  const { setPremium } = usePremium();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [state, setState] = useState<Verification>('verifying');

  useEffect(() => {
    // Sin session_id no hay nada verificable → no se concede premium.
    if (!sessionId) {
      setState('pending');
      return;
    }

    let cancelled = false;
    fetch(`${API_URL}/payments/stripe/session/${encodeURIComponent(sessionId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { premium?: boolean } | null) => {
        if (cancelled) return;
        if (data?.premium) {
          // Pago confirmado por el servidor → mutación en caliente: todos los
          // <AdBanner> montados reciben el cambio sin recargar.
          setPremium(true);
          track('premium_purchase_completed', { plan: 'premium' });
          setState('granted');
        } else {
          setState('pending');
        }
      })
      .catch(() => { if (!cancelled) setState('error'); });

    return () => { cancelled = true; };
  }, [sessionId, setPremium]);

  const heading =
    state === 'granted' ? '¡Ya eres Premium!'
    : state === 'pending' ? 'Estamos confirmando tu pago'
    : state === 'error' ? 'No hemos podido confirmar el pago'
    : 'Confirmando tu pago…';

  const message =
    state === 'granted'
      ? 'Tu pago se ha procesado correctamente. Disfruta de Stick Live sin publicidad.'
      : state === 'pending'
        ? 'Tu pago aún se está confirmando en la pasarela. En cuanto se complete, tu cuenta se activará automáticamente. No necesitas hacer nada más.'
        : state === 'error'
          ? 'Si el cargo se ha realizado, el premium se activará en breve. Si no, puedes intentarlo de nuevo desde Ajustes.'
          : 'Un momento, estamos verificando el pago con la pasarela.';

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center gap-5">
      {/* Icono */}
      <div className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg
                       ${state === 'granted'
                         ? 'bg-gradient-to-br from-amber-400 to-amber-500'
                         : 'bg-slate-100 dark:bg-slate-800'}`}>
        {state === 'granted' ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 text-white">
            <path d="M12 2L9 9 2 9l5.5 4-2 7L12 16l6.5 4-2-7L22 9l-7 0z" />
          </svg>
        ) : state === 'verifying' ? (
          <span className="w-9 h-9 rounded-full border-4 border-slate-300/40 border-t-rink-passion animate-spin" aria-hidden="true" />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
               className="w-10 h-10 text-rink-passion">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" strokeLinecap="round" />
          </svg>
        )}
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-extrabold text-slate-900 dark:text-slate-50">
          {heading}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
          {message}
        </p>
      </div>

      <Link
        href={state === 'granted' ? '/' : '/settings'}
        className="inline-flex items-center gap-2 bg-rink-passion hover:bg-red-700
                   text-white font-semibold text-sm px-5 py-2.5 rounded-xl
                   transition-colors focus:outline-none focus-visible:ring-2
                   focus-visible:ring-rink-passion focus-visible:ring-offset-2"
      >
        {state === 'granted' ? (
          <>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M9.293 2.293a1 1 0 011.414 0l7 7A1 1 0 0117 11h-1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-3a1 1 0 00-1-1H9a1 1 0 00-1 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-6H3a1 1 0 01-.707-1.707l7-7z" clipRule="evenodd" />
            </svg>
            Ver la app sin anuncios
          </>
        ) : (
          'Ir a Ajustes'
        )}
      </Link>
    </div>
  );
}

export default function PremiumSuccessPage() {
  // `useSearchParams` exige un límite de Suspense en el App Router (Next 15+).
  return (
    <Suspense fallback={null}>
      <PremiumSuccessInner />
    </Suspense>
  );
}
