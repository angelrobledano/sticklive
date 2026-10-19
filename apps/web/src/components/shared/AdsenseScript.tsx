'use client';

/**
 * <AdsenseScript />
 *
 * Carga `adsbygoogle.js` si AdSense está configurado. Montado una vez en el
 * layout raíz.
 *
 * Desde la unificación del consentimiento, el tag se carga SIEMPRE (también
 * para Premium) porque es el que publica el CMP de Google (`__tcfapi`): sin él
 * no habría aviso único ni forma de conceder/retirar los propósitos de
 * analítica y publicidad. Los usuarios Premium no tienen huecos de anuncio, así
 * que no se solicita publicidad para ellos.
 *
 * El CMP de Google decide qué anuncios se sirven (personalizados o no) y el
 * estado TCF alimenta la puerta de PostHog en `lib/consent-tcf.ts`.
 */

import { useEffect } from 'react';
import { usePremium } from '@/context/PremiumContext';
import { adsenseConfig, loadAdsenseScript } from '@/lib/ads';

const ADS = adsenseConfig();

export function AdsenseScript() {
  const { mounted } = usePremium();

  useEffect(() => {
    if (!mounted || !ADS.client) return;
    loadAdsenseScript(ADS.client);
  }, [mounted]);

  return null;
}
