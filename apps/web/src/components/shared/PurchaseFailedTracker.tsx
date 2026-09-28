'use client';

import { useEffect } from 'react';
import { trackOnce } from '@/lib/analytics';

/**
 * Clave de idempotencia (#247): el identificador de la operación que viene en
 * la URL (`order` de Redsys o `session_id` de Stripe) y, si no hay, el
 * proveedor. De este modo recargar /premium/error no vuelve a contar el mismo
 * fallo. Limitación conocida: dos fallos reales en la misma pestaña sin
 * identificador (p. ej. cancelación Stripe, que no envía `order`) se cuentan
 * una sola vez.
 */
function failureEventKey(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const op = params.get('order') ?? params.get('session_id') ?? params.get('provider');
    return op ? `premium-failed:${op}` : 'premium-failed:unknown';
  } catch {
    return 'premium-failed:unknown';
  }
}

/**
 * Tracker invisible: emite premium_purchase_failed al montar, UNA sola vez por
 * operación/pestaña (#247). Permite medir el fallo de pago desde una página
 * server-rendered (la de error de premium) sin sobrecontar en cada recarga.
 */
export function PurchaseFailedTracker({ reason = 'cancelled_or_declined' }: { reason?: string }) {
  useEffect(() => {
    trackOnce(failureEventKey(), 'premium_purchase_failed', { reason });
  }, [reason]);
  return null;
}
