import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import es from '@/locales/es.json';
import type { MatchDetail, MatchRound } from '@/lib/api/client';
import { MatchHeader } from './MatchHeader';

/**
 * Spec 2026-10-16: la ficha dice en qué fase se juega el partido, bajo el
 * nombre de la competición y en el h1 oculto: «Semifinal», «Fase de grupos ·
 * Grupo A · Jornada 2», «3.er y 4.º puesto»…
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/matches/m1',
  useSearchParams: () => new URLSearchParams(''),
}));

const ROUND: MatchRound = {
  name: null, number: null, type: null, stage: null, groupName: null, seriesGame: null, phaseKind: null,
};

function data(round: Partial<MatchRound> | null): MatchDetail {
  const team = (id: string, name: string) => ({ id, name, shortName: name.slice(0, 3).toUpperCase(), logoUrl: null });
  return {
    match: {
      id: 'm1', seasonId: 's1', roundId: 'r1',
      competitionId: 'c1', competitionName: 'Mundial Masculino — World Skate',
      competitionSlug: 'mundial-masculino-worldskate', competitionTimezone: 'Europe/Madrid',
      status: 'scheduled', scheduledAt: '2026-10-16T20:15:00Z', startedAt: null, finishedAt: null,
      score: { home: null, away: null }, venue: null,
      homeTeamId: 'fra', awayTeamId: 'por', homeTeam: team('fra', 'Francia'), awayTeam: team('por', 'Portugal'),
      sourceRef: null, referee: null, live: null,
      round: round ? { ...ROUND, ...round } : null,
    },
    events: [],
    stats: {} as MatchDetail['stats'],
    lineups: { home: [], away: [] },
  } as MatchDetail;
}

const render = (round: Partial<MatchRound> | null) => renderToStaticMarkup(
  <I18nProvider initialLocale="es" dict={es as never} referenceDict={es as never}>
    <MatchHeader data={data(round)} />
  </I18nProvider>,
);

describe('MatchHeader — fase del partido', () => {
  it('semifinal', () => {
    const html = render({ name: 'Semifinal', number: 95, type: 'playoff', stage: 'semis', phaseKind: 'knockout' });
    expect(html).toContain('data-round-label="true"');
    expect(html).toMatch(/data-round-label="true"[^>]*>Semifinal</);
    // También en el h1 para lectores de pantalla.
    expect(html).toMatch(/<h1[^>]*>[^<]*Mundial Masculino — World Skate · Semifinal/);
  });

  it('fase de grupos con grupo y jornada', () => {
    const html = render({ name: 'Jornada 2', number: 2, type: 'regular', groupName: 'A', phaseKind: 'groups' });
    expect(html).toContain('Fase de grupos · Grupo A · Jornada 2');
  });

  it('3.er y 4.º puesto', () => {
    expect(render({ name: '3º y 4º puesto', number: 98, type: 'playoff', stage: 'third_place' }))
      .toContain('3.er y 4.º puesto');
  });

  it('sin ronda no pinta línea de fase', () => {
    expect(render(null)).not.toContain('data-round-label');
  });
});
