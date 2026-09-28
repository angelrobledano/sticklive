'use client';

/**
 * <AdsenseScript />
 *
 * Carga `adsbygoogle.js` solo si AdSense está configurado, hay consentimiento y
 * el usuario no es Premium. Montado una vez en el layout raíz. No pinta nada.
 */

import { useEffect } from 'react';
import { usePremium } from '@/context/PremiumContext';
import { adsEnabled, adsenseConfig, useAdConsent, loadAdsenseScript } from '@/lib/ads';

const ADS = adsenseConfig();

export function AdsenseScript() {
  const { isPremium, mounted } = usePremium();
  const consentGranted = useAdConsent();

  useEffect(() => {
    if (!mounted) return;
    if (!adsEnabled({ client: ADS.client, premium: isPremium, consentGranted })) return;
    loadAdsenseScript(ADS.client);
  }, [mounted, isPremium, consentGranted]);

  return null;
}
