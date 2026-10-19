'use client';

/**
 * <AdsenseScript />
 *
 * Carga `adsbygoogle.js` si AdSense está configurado, el usuario no es Premium
 * y ya ha respondido al aviso de analítica. Montado una vez en el layout raíz.
 * No pinta nada.
 *
 * La espera es de rendimiento: si el usuario nunca contesta, no se descargan
 * AdSense ni Funding Choices. Cuando contesta (acepte o rechace analítica), se
 * carga el tag y el CMP de Google sigue gobernando el consentimiento
 * publicitario (ver docs/monetizacion.md §4).
 */

import { useEffect } from 'react';
import { usePremium } from '@/context/PremiumContext';
import { useConsentState } from '@/hooks/useConsentState';
import { adsConsentReady, adsEnabled, adsenseConfig, loadAdsenseScript } from '@/lib/ads';

const ADS = adsenseConfig();

export function AdsenseScript() {
  const { isPremium, mounted } = usePremium();
  const consent = useConsentState();

  useEffect(() => {
    if (!mounted || !adsConsentReady(consent)) return;
    if (!adsEnabled({ client: ADS.client, premium: isPremium })) return;
    loadAdsenseScript(ADS.client);
  }, [mounted, isPremium, consent]);

  return null;
}
