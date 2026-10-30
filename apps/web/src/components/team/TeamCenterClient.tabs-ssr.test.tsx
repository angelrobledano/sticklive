import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { TeamCenterClient, type TeamDetailView } from './TeamCenterClient';
import teamJson from './__fixtures__/team-detail.json';

/**
 * GSC (16-oct-2026): las fichas de equipo cuentan como "rastreada, sin indexar".
 * Causa medida en producción: los paneles de pestaña se montaban
 * CONDICIONALMENTE (`activeTab === 'X' && <Tab/>`), así que el HTML solo
 * llevaba el panel activo — 134 palabras, 0 tablas — y Googlebot no pulsa
 * pestañas: nunca veía plantilla (12 jugadores), calendario (20 partidos) ni
 * estadísticas, que ya viajan en las props.
 *
 * El fixture es la respuesta REAL de la API de un equipo
 * (`/api/teams/005c416e-…`) para que el test no dependa de datos inventados.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/teams/t1',
  useParams: () => ({ locale: 'es' }),
  useSearchParams: () => new URLSearchParams(),
}));

const data = teamJson as unknown as TeamDetailView;

function render(): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={{}} referenceDict={{}}>
      <TeamCenterClient data={data} />
    </I18nProvider>,
  );
}

describe('TeamCenterClient — paneles en el HTML servido', () => {
  it('monta los CUATRO paneles y oculta los tres inactivos', () => {
    const html = render();
    expect((html.match(/hidden=""/g) ?? []).length).toBe(3);
  });

  it('el HTML trae plantilla y calendario aunque la pestaña activa sea Resumen', () => {
    const html = render();
    // Plantilla: apellido de un jugador del fixture (la página lo normaliza).
    expect(html.toLowerCase()).toContain('iglesias');
    // Calendario: enlace a un partido del fixture.
    expect(html).toContain(`/matches/${data.matches[0]!.id}`);
  });
});

describe('TeamCenterClient — otros equipos del club (club con muchos equipos)', () => {
  it('recogido: 6 equipos con categoría y liga, y «Ver los N equipos»', () => {
    const ages = ['senior', 'junior', 'juvenil', 'infantil', 'alevin', 'alevin', 'benjamin', 'benjamin', 'prebenjamin', 'veteranos'];
    const clubTeams = ages.map((a, i) => ({
      id: `ct${i}`, name: 'SHUM', shortName: null, logoUrl: null, gender: 'male', ageCategory: a,
      squadLevel: i === 5 || i === 7 ? 2 : 1, teamType: 'club', sectionSuffix: '',
      competition: { id: `c${i}`, slug: null, name: `LIGA ${i}` },
    }));
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="es" dict={{}} referenceDict={{}}>
        <TeamCenterClient data={{ ...data, clubTeams } as TeamDetailView} />
      </I18nProvider>,
    );
    expect((html.match(/href="\/es\/teams\/ct\d"/g) ?? []).length).toBe(6);
    expect(html).toContain('Liga 0');
    expect(html).toContain('Ver los 10 equipos');
  });
});
