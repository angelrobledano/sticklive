import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n';
import { SeasonNoteLine } from './SeasonNote';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/competitions/ok-liga',
  useSearchParams: () => new URLSearchParams(),
}));

const ES = {
  season: { note: { covid: 'Temporada finalizada por COVID-19 en la jornada {matchday}' } },
};

function render(node: ReactNode, dict: unknown = ES) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={dict as never} referenceDict={dict as never}>
      {node}
    </I18nProvider>,
  );
}

describe('SeasonNoteLine (#389)', () => {
  it('muestra el motivo localizado e interpolado', () => {
    const html = render(<SeasonNoteLine competitionSlug="ok-liga-masculina" seasonSlug="2019-20" />);
    expect(html).toContain('COVID-19');
    expect(html).toContain('jornada 25');
  });

  it('no renderiza nada si la temporada no tiene nota', () => {
    const html = render(<SeasonNoteLine competitionSlug="ok-liga-masculina" seasonSlug="2020-21" />);
    expect(html).toBe('');
  });

  it('cae al texto en español si falta la clave en el diccionario', () => {
    const html = render(<SeasonNoteLine competitionSlug="ok-liga-masculina" seasonSlug="2019-20" />, {});
    expect(html).toContain('jornada 25');
  });
});
