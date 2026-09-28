import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { CompetitionClient } from './CompetitionClient';
import type { SeasonOverview, SeasonStandingRow } from '@/lib/api/client';

/**
 * #339 (competición): aunque la pestaña activa sea Clasificación (o no haya
 * clasificación), el HTML SSR debe enlazar los partidos y los equipos. Antes
 * solo se enlazaban equipos via la tabla de clasificación y 0 partidos.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, prefetch: () => {} }),
  usePathname: () => '/es/competitions/c1',
  useSearchParams: () => new URLSearchParams(''),
}));

function standing(): SeasonStandingRow {
  return {
    id: 'st1', teamId: 't1', teamName: 'Equipo Uno', teamShortName: 'UNO', teamLogoUrl: null,
    groupName: null, position: 1, played: 0, won: 0, drawn: 0, lost: 0,
    goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0, form: [], penalizationPoints: 0,
  };
}

const DATA: SeasonOverview = {
  season: {
    id: 's1', name: '2026/27', startDate: null, endDate: null,
    competitionId: 'c1', competitionName: 'OK Liga Masculina', competitionNameI18n: null,
    competitionShort: 'OKL', competitionOrganizer: 'FEP', competitionScope: 'national',
    competitionCountry: 'ES', competitionRegion: null, competitionTimezone: 'Europe/Madrid',
  },
  standings: [standing()],
  rounds: [],
  matches: [{
    id: 'm1', status: 'scheduled', competitionTimezone: 'Europe/Madrid',
    scheduledAt: '2026-10-31T15:30:00.000Z', startedAt: null, finishedAt: null,
    score: { home: null, away: null }, venueName: null, roundId: null,
    roundNumber: null, roundName: null, roundType: 'regular',
    homeTeam: { id: 't1', name: 'Equipo Uno', shortName: 'UNO', logoUrl: null },
    awayTeam: { id: 't2', name: 'Equipo Dos', shortName: 'DOS', logoUrl: null },
  }],
};

describe('CompetitionClient índice enlazado (#339)', () => {
  it('enlaza equipos y partidos en el HTML inicial aunque el tab activo no los muestre', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="es" dict={{}} referenceDict={{}}>
        <CompetitionClient data={DATA} competitionId="c1" />
      </I18nProvider>,
    );
    expect(html).toContain('/teams/t1');
    expect(html).toContain('/teams/t2');
    expect(html).toContain('/matches/m1');
  });
});
