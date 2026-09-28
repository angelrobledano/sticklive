import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import LocaleNotFound from './not-found';

/**
 * #336: el 404 localizado debe dar salida (nav/CTA) y hablar el idioma activo.
 * Verificación de UI sin navegador vía render estático: aquí NO se comprueba el
 * status HTTP (el 404 real lo garantiza `notFound()`; ver informe).
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/xx/ruta-inexistente',
}));

const ES = {
  errors: {
    not_found_title: 'Página no encontrada',
    not_found_body: 'Cuerpo en español',
    not_found_home: 'Volver al inicio',
    not_found_competitions: 'Ver competiciones',
  },
};
const EN = {
  errors: {
    not_found_title: 'Page not found',
    not_found_body: 'Body in english',
    not_found_home: 'Back home',
    not_found_competitions: 'Browse competitions',
  },
};

function render(locale: string, dict: unknown) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale as never} dict={dict as never} referenceDict={ES as never}>
      <LocaleNotFound />
    </I18nProvider>,
  );
}

describe('not-found localizado (#336)', () => {
  it('muestra el copy del diccionario activo y CTAs de salida', () => {
    const html = render('es', ES);
    expect(html).toContain('Página no encontrada');
    expect(html).toContain('Cuerpo en español');
    expect(html).toContain('Volver al inicio');
    expect(html).toContain('Ver competiciones');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/competitions"');
  });

  it('usa el idioma del locale (no texto fijo en español)', () => {
    const html = render('en', EN);
    expect(html).toContain('Page not found');
    expect(html).not.toContain('Página no encontrada');
  });
});
