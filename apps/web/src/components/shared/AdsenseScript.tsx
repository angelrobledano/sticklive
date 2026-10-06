'use client';

/**
 * <AdsenseScript />
 *
 * Carga `adsbygoogle.js` si AdSense está configurado y el usuario no es Premium.
 * Montado una vez en el layout raíz. No pinta nada.
 *
 * El tag debe cargarse aunque el usuario aún no haya elegido sobre la analítica:
 * el mensaje de consentimiento publicitario del CMP de Google se sirve a través
 * de este mismo script (ver docs/monetizacion.md §4). El consentimiento de
 * analítica solo gobierna PostHog, no los anuncios.
 */

import { useEffect } from 'react';
import { usePremium } from '@/context/PremiumContext';
import { adsEnabled, adsenseConfig, loadAdsenseScript } from '@/lib/ads';

const ADS = adsenseConfig();

export function AdsenseScript() {
  const { isPremium, mounted } = usePremium();

  useEffect(() => {
    if (!mounted) return;
    if (!adsEnabled({ client: ADS.client, premium: isPremium })) return;
    loadAdsenseScript(ADS.client);
  }, [mounted, isPremium]);

  return null;
}
