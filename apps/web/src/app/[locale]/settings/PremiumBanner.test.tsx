import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { PremiumProvider } from '@/context/PremiumContext';
import { PremiumBanner } from './PremiumBanner';

/**
 * El paywall muestra dos opciones (anual y para siempre) SOLO con Stripe. El
 * proveedor se decide en build por `NEXT_PUBLIC_PAYMENT_PROVIDER`; se sustituye
 * por una variable mutable para poder renderizar en ambos modos.
 */
const config = vi.hoisted(() => ({ provider: 'stripe' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/settings',
}));

vi.mock('./config', () => ({
  get PAYMENT_PROVIDER() { return config.provider; },
  API_URL: 'http://localhost:3000',
  REDSYS_URL: 'https://sis-t.redsys.es',
}));

const DICT = {
  settings: {
    premium_title: 'Stick Live Premium',
    perk_no_ads: 'Sin anuncios',
    perk_rt_notifs: 'Ayudas',
    perk_early: 'Mejoras',
    premium_cta: 'CTA_ANUAL',
    premium_cta_lifetime: 'CTA_VIDA',
    premium_connecting: 'Conectando…',
    premium_error: 'No se pudo iniciar el pago.',
    premium_sandbox: 'sandbox',
  },
  premium: {
    product_annual: 'Anual',
    product_annual_desc: 'desc-anual',
    product_lifetime: 'Para siempre',
    product_lifetime_desc: 'desc-vida',
  },
};

function render(): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={DICT as never} referenceDict={DICT as never}>
      <PremiumProvider>
        <PremiumBanner deviceId="dev-1" />
      </PremiumProvider>
    </I18nProvider>,
  );
}

const buttonCount = (html: string) => (html.match(/<button/g) ?? []).length;

describe('PremiumBanner — dos opciones de pago', () => {
  beforeEach(() => { config.provider = 'stripe'; });

  it('con proveedor Stripe ofrece anual y para siempre (dos botones)', () => {
    const html = render();
    expect(html).toContain('Anual');
    expect(html).toContain('Para siempre');
    expect(buttonCount(html)).toBe(2);
  });

  it('con un proveedor no-Stripe solo ofrece el anual (un botón)', () => {
    config.provider = 'redsys';
    const html = render();
    expect(html).toContain('Anual');
    expect(html).not.toContain('Para siempre');
    expect(buttonCount(html)).toBe(1);
  });
});
