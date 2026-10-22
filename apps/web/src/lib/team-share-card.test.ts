import { describe, it, expect } from 'vitest';
import { teamShareCard, shareImageQuery } from './team-share-card';
import type { TeamDetail, TeamMatchSummary } from './api/types';

/**
 * Contenido de la imagen para compartir la ficha de un equipo: lo que se
 * lleva el aficionado a Instagram/WhatsApp. Todo desde el punto de vista del
 * equipo compartido.
 */
const CAL = { id: 'cal', name: 'CALAFELL LA MENORQUINA', shortName: 'CAL', logoUrl: 'x' };
const LIC = { id: 'lic', name: 'DEPORTIVO LICEO', shortName: 'LIC', logoUrl: 'x' };
const BAR = { id: 'bar', name: 'BARÇA', shortName: 'BAR', logoUrl: 'x' };

function partido(id: string, home: typeof CAL, away: typeof CAL, score: [number | null, number | null], date: string, extra: Partial<TeamMatchSummary> = {}): TeamMatchSummary {
  return {
    id, status: score[0] == null ? 'scheduled' : 'finished', scheduledAt: date, startedAt: null, finishedAt: null,
    score: { home: score[0], away: score[1] }, venue: null, homeTeam: home, awayTeam: away, ...extra,
  } as TeamMatchSummary;
}

function detalle(matches: TeamMatchSummary[]): TeamDetail {
  return {
    team: { id: 'cal', name: 'CALAFELL LA MENORQUINA', shortName: 'CAL', city: 'Calafell', country: 'ES', logoUrl: 'x', websiteUrl: null, gender: 'male', ageCategory: 'senior', club: null },
    standing: {
      seasonId: 's', competitionId: 'c', competitionName: 'OK LIGA MASCULINA', competitionShort: 'OK Liga',
      position: 3, played: 8, won: 6, drawn: 1, lost: 1, goalsFor: 40, goalsAgainst: 22, goalDiff: 18, points: 19,
      form: [], penalizationPoints: 0,
    },
    seasons: [{ id: 's', name: '2026/27', isCurrent: true, competitionName: 'OK LIGA MASCULINA', competitionShort: 'OK Liga' }],
    selectedSeasonId: 's',
    matches, squad: [],
  } as TeamDetail;
}

const NOW = new Date('2026-10-22T12:00:00Z');

describe('teamShareCard', () => {
  it('cabecera: competición, temporada, posición, puntos y balance', () => {
    const c = teamShareCard(detalle([]), { locale: 'es', now: NOW });
    expect(c).toMatchObject({
      teamName: 'Calafell la Menorquina', competition: 'OK Liga', season: '2026/27',
      position: 3, points: 19, record: { played: 8, won: 6, drawn: 1, lost: 1, goalsFor: 40, goalsAgainst: 22 },
    });
  });

  it('forma de los 5 últimos terminados, del más antiguo al más reciente y desde el punto de vista del equipo', () => {
    const c = teamShareCard(detalle([
      partido('1', CAL, LIC, [5, 3], '2026-09-20T18:00:00Z'),
      partido('2', BAR, CAL, [4, 1], '2026-09-27T18:00:00Z'),
      partido('3', CAL, BAR, [2, 2], '2026-10-04T18:00:00Z'),
      partido('4', LIC, CAL, [2, 3], '2026-10-11T18:00:00Z'),
      partido('5', CAL, LIC, [1, 1], '2026-10-18T18:00:00Z', { winnerTeamId: 'cal', winType: 'penalties' }),
      partido('6', CAL, BAR, [1, 0], '2026-09-13T18:00:00Z'),
      partido('7', CAL, BAR, [null, null], '2026-10-25T18:00:00Z'),
    ]), { locale: 'es', now: NOW });
    expect(c.form).toEqual(['W', 'L', 'D', 'W', 'W']);
  });

  it('último resultado y próximo partido', () => {
    const c = teamShareCard(detalle([
      partido('1', CAL, LIC, [5, 3], '2026-10-18T18:00:00Z'),
      partido('2', BAR, CAL, [null, null], '2026-10-25T17:00:00Z', { competitionTimezone: 'Europe/Madrid' }),
      partido('3', CAL, LIC, [null, null], '2026-11-01T17:00:00Z'),
    ]), { locale: 'es', now: NOW });
    expect(c.lastMatch).toMatchObject({ opponent: 'Deportivo Liceo', home: true, teamGoals: 5, opponentGoals: 3, outcome: 'W' });
    expect(c.nextMatch).toMatchObject({ opponent: 'Barça', home: false });
    expect(c.nextMatch?.when).toMatch(/25/);
  });

  it('sin clasificación ni partidos, la tarjeta sigue siendo válida', () => {
    const d = detalle([]);
    d.standing = null;
    const c = teamShareCard(d, { locale: 'es', now: NOW });
    expect(c).toMatchObject({ position: null, record: null, form: [], lastMatch: null, nextMatch: null });
  });
});

describe('shareImageQuery', () => {
  it('normaliza formato y tema, con valores por defecto seguros', () => {
    expect(shareImageQuery(new URLSearchParams('format=story&theme=light'))).toEqual({ format: 'story', theme: 'light' });
    expect(shareImageQuery(new URLSearchParams('format=xx&theme=<script>'))).toEqual({ format: 'post', theme: 'dark' });
  });
});
