'use client';

import { useEffect } from 'react';
import { track } from '@/lib/analytics';

/**
 * Tracker invisible: emite premium_purchase_failed al montar. Permite medir el
 * fallo de pago desde una página server-rendered (la de error de premium).
 */
export function PurchaseFailedTracker({ reason = 'cancelled_or_declined' }: { reason?: string }) {
  useEffect(() => {
    track('premium_purchase_failed', { reason });
  }, [reason]);
  return null;
}
