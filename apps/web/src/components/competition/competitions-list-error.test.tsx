import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { CompetitionsList } from './CompetitionsList';

/**
 * #347: el estado de error de la lista de competiciones NO debe volcar el
 * detalle crudo de la API al DOM ("API 500 - /competitions: ..."), ni usar el
 * copy de "sin datos". Debe ser un mensaje amigable con reintento.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/competitions',
}));

const ES = {
  errors: {
    competitions_load_title: 'No hemos podido cargar las competiciones',
    load_body: 'Ha habido un problema de conexión. Inténtalo de nuevo en unos segundos.',
    retry: 'Reintentar',
  },
  standings: { no_data: 'Sin datos de clasificación' },
};
const EN = {
  errors: {
    competitions_load_title: 'Could not load competitions',
    load_body: 'Please try again in a few seconds.',
    retry: 'Retry',
  },
};

const RAW = 'API 500 - /competitions: {"detail":"internal stack secret"}';

function render(dict: unknown) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en" dict={dict as never} referenceDict={ES as never}>
      <CompetitionsList competitions={[]} error={RAW} />
    </I18nProvider>,
  );
}

describe('CompetitionsList estado de error (#347)', () => {
  it('no filtra el error crudo y ofrece copy amigable + reintento', () => {
    const html = render(EN);
    expect(html).not.toContain('API 500');
    expect(html).not.toContain('internal stack secret');
    expect(html).not.toContain('Sin datos de clasificación');
    expect(html).toContain('Could not load competitions');
    expect(html).toContain('Retry');
    expect(html).toContain('<button');
  });
});
