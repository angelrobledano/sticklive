import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import es from '@/locales/es.json';
import { FavoritesOverview } from './FavoritesOverview';

vi.mock('next/navigation', () => ({ usePathname: () => '/es/favorites', useRouter: () => ({ push: () => {} }) }));

const team = (id: string) => ({ id, name: id.toUpperCase() });
describe('FavoritesOverview', () => {
  const html = renderToStaticMarkup(
    <I18nProvider initialLocale="es" dict={es as never} referenceDict={es as never}>
      <FavoritesOverview
        teamIds={['reus', 'liceo']}
        matches={[
          { id: 'l', status: 'live', scheduledAt: new Date().toISOString(), homeTeam: team('liceo'), awayTeam: team('barca'), score: { home: 2, away: 1 } },
          { id: 'f', status: 'finished', scheduledAt: '2026-10-31T17:00:00Z', homeTeam: team('reus'), awayTeam: team('cal'), score: { home: 3, away: 1 } },
        ]}
        teamNames={{}}
        leagues={[{ id: 'ok', name: 'OK LIGA MASCULINA', slug: 'ok-liga-masculina' }]}
        players={[{ id: 'p1', name: 'Aitor Aguirrezabala' }]}
        editHref="/favorites?edit=1"
      />
    </I18nProvider>,
  );
  it('el equipo en directo va primero, con su marcador', () => {
    expect(html.indexOf('Liceo')).toBeLessThan(html.indexOf('Reus'));
    expect(html).toContain('En directo · 2-1');
  });
  it('último resultado con su letra (victoria)', () => {
    expect(html).toMatch(/3-1<span[^>]*>V</);
  });
  it('competiciones y jugadores enlazados, y acceso a seguir más', () => {
    expect(html).toContain('/es/competitions/ok-liga-masculina');
    expect(html).toContain('/es/players/p1');
    expect(html).toContain('Seguir más equipos o ligas');
  });
});
