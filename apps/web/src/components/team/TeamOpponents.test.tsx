import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import type { TeamDetail, TeamMatchSummary } from '@/lib/api/types';
import { TeamOpponents, teamOpponents } from './TeamOpponents';

vi.mock('next/navigation', () => ({
  usePathname: () => '/es/teams/a',
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
}));

const team = (id: string, name: string) => ({ id, name, shortName: null, logoUrl: null });
const match = (home: string, away: string, homeName = home, awayName = away) =>
  ({ homeTeam: team(home, homeName), awayTeam: team(away, awayName) }) as TeamMatchSummary;

describe('teamOpponents', () => {
  it('deduplica rivales, excluye al propio equipo y ordena por nombre', () => {
    const matches = [
      match('a', 'c', 'Local', 'Cerdanyola'),
      match('b', 'a', 'Barça', 'Local'),
      match('a', 'b', 'Local', 'Barça'),
      match('a', 'c', 'Local', 'Cerdanyola'),
    ];
    expect(teamOpponents(matches, 'a').map((t) => t.id)).toEqual(['b', 'c']);
  });

  it('devuelve vacío si no hay partidos', () => {
    expect(teamOpponents([], 'a')).toEqual([]);
  });
});

describe('TeamOpponents', () => {
  it('enlaza a la competición y a cada rival en el HTML servido', () => {
    const data = {
      team: team('a', 'Local'),
      standing: {
        seasonId: 's1', competitionId: 'c1', competitionName: 'Liga',
        competitionShort: 'Liga', position: 1, played: 1, won: 1, drawn: 0, lost: 0,
        goalsFor: 2, goalsAgainst: 1, goalDiff: 1, points: 3, form: [], penalizationPoints: 0,
      },
      matches: [match('a', 'b', 'Local', 'Visitante')],
      squad: [],
    } as unknown as TeamDetail;

    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="es" dict={{}} referenceDict={{}}>
        <TeamOpponents data={data} locale="es" />
      </I18nProvider>,
    );

    expect(html).toContain('Rivales');
    expect(html).toContain('href="/es/competitions/c1?season=s1"');
    expect(html).toContain('href="/es/teams/b"');
    expect(html).toContain('Visitante');
  });
});
