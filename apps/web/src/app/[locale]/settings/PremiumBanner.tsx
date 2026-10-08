'use client';

import { useState, useEffect, useCallback } from 'react';
import { useT } from '@/lib/i18n';
import { usePremium } from '@/context/PremiumContext';
import { track } from '@/lib/analytics';
import { API_URL, REDSYS_URL, PAYMENT_PROVIDER, type RedsysPayload } from './config';
import { buildCheckoutPayload, type CheckoutProduct } from './checkout';

/**
 * Paywall de dos opciones: anual (renovable) y para siempre (pago único).
 *
 * Los IMPORTES no se muestran aquí a propósito: el precio lo define el catálogo
 * del API (fuente única server-side) y lo presenta Stripe en el Checkout. Exponer
 * precios públicos en la web es follow-up; duplicarlos garantizaría drift.
 */
function CheckoutOption({ title, description, cta, loading, highlight = false, onSelect }: {
  title: string;
  description: string;
  cta: string;
  loading: boolean;
  highlight?: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`rounded-xl p-3 flex items-center justify-between gap-3
                  ${highlight ? 'bg-white/15 ring-1 ring-white/40' : 'bg-white/5'}`}
    >
      <div className="min-w-0">
        <p className="text-sm font-bold text-white">{title}</p>
        <p className="text-xs text-white/70 leading-snug">{description}</p>
      </div>

      <button
        onClick={onSelect}
        disabled={loading}
        aria-busy={loading || undefined}
        className={`shrink-0 flex items-center gap-1.5 font-bold text-sm
                    px-3.5 py-2.5 rounded-xl
                    active:scale-95 transition-all duration-150
                    disabled:opacity-60 disabled:cursor-not-allowed
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-white
                    focus-visible:ring-offset-2 focus-visible:ring-offset-rink-passion
                    ${highlight
                      ? 'bg-white text-rink-passion shadow hover:bg-amber-50'
                      : 'bg-white/15 text-white ring-1 ring-white/30 hover:bg-white/25'}`}
      >
        {loading ? (
          <>
            <span
              className={`w-4 h-4 rounded-full border-2 animate-spin ${highlight
                ? 'border-rink-passion/30 border-t-rink-passion'
                : 'border-white/30 border-t-white'}`}
              aria-hidden="true"
            />
            Conectando…
          </>
        ) : (
          <>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path d="M12 2L9 9 2 9l5.5 4-2 7L12 16l6.5 4-2-7L22 9l-7 0z" />
            </svg>
            {cta}
          </>
        )}
      </button>
    </div>
  );
}

export function PremiumBanner({ deviceId }: { deviceId: string }) {
  const { t } = useT();
  const { setPremium } = usePremium();
  // Carga POR PRODUCTO: pedir el anual no bloquea la opción de por vida.
  const [loadingProduct, setLoadingProduct] = useState<CheckoutProduct | null>(null);
  const [error, setError]           = useState<string | null>(null);

  // Tope del funnel de conversión: el usuario ve el bloque premium.
  useEffect(() => { track('premium_viewed', { from_screen: 'settings' }); }, []);

  /**
   * 1. Llama al Checkout del proveedor activo con el producto elegido.
   * 2. Redirige a la pasarela (Stripe) o inyecta el formulario firmado (Redsys).
   */
  const handleCheckout = useCallback(async (product: CheckoutProduct) => {
    if (!deviceId) return;
    track('premium_checkout_started', { product });
    setLoadingProduct(product);
    setError(null);

    // ── Proveedor ACTIVO: Stripe (Redsys queda abajo por si se vuelve) ──────
    if (PAYMENT_PROVIDER === 'stripe') {
      try {
        const res = await fetch(`${API_URL}/payments/stripe/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildCheckoutPayload(deviceId, product)),
        });
        // 409: el servidor (fuente de verdad) confirma que ya es premium. Se
        // refleja en el estado global y Ajustes pinta el badge de premium activo.
        if (res.status === 409) {
          setPremium(true);
          return;
        }
        const body = await res.json() as { url?: string; error?: string };
        if (!res.ok || !body.url) throw new Error(body.error ?? `HTTP ${res.status}`);
        window.location.href = body.url; // → Stripe Checkout
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido');
        setLoadingProduct(null);
      }
      return;
    }

    // ── Redsys (proveedor alternativo) ──────────────────────────────────────
    try {
      const res = await fetch(`${API_URL}/payments/redsys/create-json`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ deviceId }),
      });

      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const payload = await res.json() as RedsysPayload;

      // Inyectar formulario invisible y hacer submit automático
      const form = document.createElement('form');
      form.method  = 'POST';
      form.action  = REDSYS_URL;
      form.style.display = 'none';

      const fields: Array<[string, string]> = [
        ['Ds_SignatureVersion',   payload.Ds_SignatureVersion],
        ['Ds_MerchantParameters', payload.Ds_MerchantParameters],
        ['Ds_Signature',          payload.Ds_Signature],
      ];

      for (const [name, value] of fields) {
        const input   = document.createElement('input');
        input.type    = 'hidden';
        input.name    = name;
        input.value   = value;
        form.appendChild(input);
      }

      document.body.appendChild(form);
      form.submit();
      // El navegador redirige — no hace falta limpiar el form
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
      setLoadingProduct(null);
    }
  }, [deviceId, setPremium]);

  return (
    <div className="rounded-2xl overflow-hidden shadow-sm">
      {/* Fondo degradado granate → amarillo */}
      <div className="bg-gradient-to-br from-rink-passion via-rink-passion-light to-amber-600 p-5 space-y-3">
        {/* Badge */}
        <div className="flex items-center gap-2">
          <span className="text-amber-300">
            {/* Corona */}
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M12 2L9 9 2 9l5.5 4-2 7L12 16l6.5 4-2-7L22 9l-7 0z" />
            </svg>
          </span>
          <span className="text-xs font-bold text-white/90 uppercase tracking-widest">
            {t('settings.premium_title')}
          </span>
        </div>

        {/* Beneficios */}
        <div className="space-y-1.5">
          {[
            t('settings.perk_no_ads'),
            t('settings.perk_rt_notifs'),
            t('settings.perk_early'),
          ].map((benefit) => (
            <div key={benefit} className="flex items-center gap-2">
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-4 h-4 text-amber-300 shrink-0"
              >
                <path
                  fillRule="evenodd"
                  d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                  clipRule="evenodd"
                />
              </svg>
              <p className="text-sm text-white/90">{benefit}</p>
            </div>
          ))}
        </div>

        {/* Opciones de compra. "Para siempre" es un producto solo de Stripe: con
            Redsys (heredado, sin catálogo de productos) se mantiene el anual único. */}
        <div className="space-y-2 pt-1">
          {PAYMENT_PROVIDER === 'stripe' && (
            <CheckoutOption
              title={t('premium.product_lifetime')}
              description={t('premium.product_lifetime_desc')}
              cta={t('settings.premium_cta_lifetime')}
              loading={loadingProduct === 'lifetime'}
              highlight
              onSelect={() => void handleCheckout('lifetime')}
            />
          )}
          <CheckoutOption
            title={t('premium.product_annual')}
            description={t('premium.product_annual_desc')}
            cta={t('settings.premium_cta')}
            loading={loadingProduct === 'annual'}
            onSelect={() => void handleCheckout('annual')}
          />
        </div>

        {/* Error inline */}
        {error && (
          <p className="text-xs text-red-200 bg-red-900/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Nota de entorno de pruebas (solo aplica al flujo Redsys) */}
        {PAYMENT_PROVIDER === 'redsys' && (
          <p className="text-[10px] text-white/40 text-center pt-1">
            {t('settings.premium_sandbox')}
          </p>
        )}
      </div>
    </div>
  );
}
