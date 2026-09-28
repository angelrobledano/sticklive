import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { HomeLoadError } from './MatchesView';

/**
 * #346: el error de carga de la home debe ofrecer reintento real y copy i18n
 * (antes: bloque inline sin botón, en español fijo para las 5 locales).
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es',
}));

const ES = {
  errors: {
    matches_load_title: 'No hemos podido cargar los partidos',
    load_body: 'Ha habido un problema de conexión. Inténtalo de nuevo en unos segundos.',
    retry: 'Reintentar',
  },
};
const EN = {
  errors: {
    matches_load_title: 'Could not load matches',
    load_body: 'Please try again in a few seconds.',
    retry: 'Retry',
  },
};

function render(dict: unknown) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en" dict={dict as never} referenceDict={ES as never}>
      <HomeLoadError />
    </I18nProvider>,
  );
}

/** Sin ninguna traducción: debe caer al español embebido, nunca a la clave. */
function renderNoDict() {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={{}} referenceDict={{}}>
      <HomeLoadError />
    </I18nProvider>,
  );
}

describe('HomeLoadError (#346)', () => {
  it('usa el copy del locale activo y muestra un botón de reintento', () => {
    const html = render(EN);
    expect(html).toContain('Could not load matches');
    expect(html).toContain('Retry');
    expect(html).toContain('<button');
    // No cae al español de referencia teniendo traducción en el idioma activo
    expect(html).not.toContain('No hemos podido cargar los partidos');
  });

  it('sin traducciones no muestra la clave cruda (fallback español embebido)', () => {
    const html = renderNoDict();
    expect(html).not.toContain('errors.');
    expect(html).toContain('No hemos podido cargar los partidos');
    expect(html).toContain('Reintentar');
  });
});
