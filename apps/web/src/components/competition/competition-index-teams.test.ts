import { describe, it, expect } from 'vitest';
import { competitionTeamsForIndex } from './CompetitionClient';
import type { SeasonMatch, SeasonStandingRow } from '@/lib/api/client';

/**
 * #339: el índice enlazado server-side debe listar cada equipo UNA vez (venga de
 * la clasificación o de los partidos), con nombre corto si lo hay y ordenado.
 */

function standing(over: Partial<SeasonStandingRow> & Pick<SeasonStandingRow, 'id' | 'teamId' | 'teamName'>): SeasonStandingRow {
  return {
    teamShortName: null,
    teamLogoUrl: null,
    groupName: null,
    position: null,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    points: 0,
    form: [],
    penalizationPoints: 0,
    ...over,
  };
}

function match(over: Partial<SeasonMatch> & Pick<SeasonMatch, 'id'>): SeasonMatch {
  return {
    status: 'scheduled',
    scheduledAt: null,
    startedAt: null,
    finishedAt: null,
    score: { home: null, away: null },
    venueName: null,
    roundId: null,
    roundNumber: null,
    roundName: null,
    roundType: 'regular',
    homeTeam: { id: 'h', name: 'Local', shortName: null, logoUrl: null },
    awayTeam: { id: 'a', name: 'Visitante', shortName: null, logoUrl: null },
    ...over,
  };
}

describe('competitionTeamsForIndex (#339)', () => {
  it('deduplica equipos entre clasificación y partidos', () => {
    const result = competitionTeamsForIndex({
      standings: [standing({ id: 's1', teamId: 't1', teamName: 'Alfa' })],
      matches: [
        match({ id: 'm1', homeTeam: { id: 't1', name: 'Alfa', shortName: null, logoUrl: null },
               awayTeam: { id: 't2', name: 'Beta', shortName: null, logoUrl: null } }),
      ],
    });
    expect(result.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('usa el nombre COMPLETO (texto ancla) y ordena por nombre', () => {
    const result = competitionTeamsForIndex({
      standings: [],
      matches: [
        match({ id: 'm1', homeTeam: { id: 'b', name: 'Beta Club', shortName: null, logoUrl: null },
               awayTeam: { id: 'a', name: 'Alfa Club', shortName: 'ALF', logoUrl: null } }),
      ],
    });
    expect(result).toEqual([
      { id: 'a', name: 'Alfa Club' },
      { id: 'b', name: 'Beta Club' },
    ]);
  });

  it('la clasificación tiene prioridad sobre el nombre del partido', () => {
    const result = competitionTeamsForIndex({
      standings: [standing({ id: 's1', teamId: 't1', teamName: 'Nombre Oficial FC' })],
      matches: [
        match({ id: 'm1', homeTeam: { id: 't1', name: 'Nombre Corto', shortName: 'NCO', logoUrl: null },
               awayTeam: { id: 't2', name: 'Otro', shortName: null, logoUrl: null } }),
      ],
    });
    expect(result).toEqual([
      { id: 't1', name: 'Nombre Oficial FC' },
      { id: 't2', name: 'Otro' },
    ]);
  });

  it('sin datos devuelve lista vacía', () => {
    expect(competitionTeamsForIndex({ standings: [], matches: [] })).toEqual([]);
  });
});
