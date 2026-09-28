import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { GameweeksTab } from './GameweeksTab';
import type { SeasonMatch } from '@/lib/api/client';

/**
 * #157 + #339 (competición): el HTML SSR de la pestaña Jornadas debe abrir en un
 * estado CON contenido y enlazar los partidos de esa jornada/fecha. Antes, sin
 * `rounds`/`roundNumber` (OK Liga), abría vacío y no enlazaba ningún partido.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/competitions/x',
  useSearchParams: () => new URLSearchParams(''),
}));

function match(id: string, day: string): SeasonMatch {
  return {
    id,
    status: 'scheduled',
    competitionTimezone: 'Europe/Madrid',
    scheduledAt: `${day}T12:00:00.000Z`,
    startedAt: null,
    finishedAt: null,
    score: { home: null, away: null },
    venueName: null,
    roundId: null,
    roundNumber: null,
    roundName: null,
    roundType: 'regular',
    homeTeam: { id: 'h1', name: 'Local', shortName: 'LOC', logoUrl: null },
    awayTeam: { id: 'a1', name: 'Visitante', shortName: 'VIS', logoUrl: null },
  };
}

// Fechas lejanas para que "el día más cercano" sea estable en el tiempo.
const MATCHES = [
  match('m1', '2099-01-15'),
  match('m2', '2099-01-20'),
];

describe('GameweeksTab render (#157/#339)', () => {
  it('abre en el día más cercano con partidos y los enlaza', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="es" dict={{}} referenceDict={{}}>
        <GameweeksTab rounds={[]} matches={MATCHES} />
      </I18nProvider>,
    );
    // Enlaza los partidos del día elegido y NO los de otro día.
    expect(html).toContain('/matches/m1');
    expect(html).not.toContain('/matches/m2');
    // No cae al estado vacío.
    expect(html).not.toContain('fixtures.empty');
  });
});
