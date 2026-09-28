import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { CompetitionsList } from './CompetitionsList';

/**
 * #170: la lista de competiciones no debe mostrar texto fijo en español. Las
 * cadenas visibles (placeholder del buscador, tabs) salen del i18n activo y, si
 * la clave aún no está en los locales, del respaldo en español vía `tt` — nunca
 * de la clave cruda.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/competitions',
}));

const EN = {
  competitions: {
    tab_my_leagues: 'My Leagues',
    tab_main: 'Top',
    tab_all: 'All',
    search_placeholder: 'Search league, country or federation...',
  },
};

function render(dict: unknown, referenceDict: unknown) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en" dict={dict as never} referenceDict={referenceDict as never}>
      <CompetitionsList competitions={[]} error={null} />
    </I18nProvider>,
  );
}

describe('CompetitionsList i18n (#170)', () => {
  it('usa el diccionario activo para placeholder y tabs', () => {
    const html = render(EN, {});
    expect(html).toContain('Search league, country or federation...');
    expect(html).toContain('My Leagues');
    expect(html).toContain('Top');
    expect(html).toContain('All');
    expect(html).not.toContain('Buscar liga');
    expect(html).not.toContain('competitions.tab_');
  });

  it('sin claves en los locales cae al español (no a la clave cruda)', () => {
    const html = render({}, {});
    expect(html).toContain('Buscar liga, país o federación...');
    expect(html).toContain('Mis Ligas');
    expect(html).toContain('Principales');
    expect(html).toContain('Todas');
    expect(html).not.toContain('competitions.search_placeholder');
  });
});
