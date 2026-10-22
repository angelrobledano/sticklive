import { describe, it, expect } from 'vitest';
import { teamStatsStory } from './team-stats-story';
import type { TeamMatchSummary, TeamSeasonStats } from './api/types';

const T = 'me';
let n = 0;
const m = (home: boolean, my: number, opp: number, day: number, oppName = 'RIVAL CP'): TeamMatchSummary => ({
  id: `m${++n}`, status: 'finished', scheduledAt: `2026-10-${String(day).padStart(2, '0')}T18:00:00Z`, startedAt: null, finishedAt: null,
  score: home ? { home: my, away: opp } : { home: opp, away: my }, venue: null,
  homeTeam: { id: home ? T : 'x', name: home ? 'ME' : oppName, shortName: null, logoUrl: null },
  awayTeam: { id: home ? 'x' : T, name: home ? oppName : 'ME', shortName: null, logoUrl: null },
});

const stats = (o: Partial<TeamSeasonStats> = {}): TeamSeasonStats => ({
  played: 6, won: 4, drawn: 1, lost: 1, goalsFor: 24, goalsAgainst: 12, assists: 5, teamFouls: 60,
  blueCards: 3, redCards: 0, timeouts: 4,
  directFouls: { total: 4, scored: 2, pct: 50 }, penalties: { total: 2, scored: 1, pct: 50 }, ...o,
});

describe('teamStatsStory', () => {
  it('titular de racha cuando lleva 3 o más victorias seguidas', () => {
    const ms = [m(true, 1, 3, 1), m(false, 2, 2, 2), m(true, 5, 1, 3), m(false, 4, 2, 4), m(true, 6, 2, 5, 'IGUALADA RIGAT')];
    const s = teamStatsStory(stats(), ms, T, { locale: 'es' });
    expect(s.headline.title).toBe('3 victorias seguidas');
    expect(s.results.streak).toEqual(['L', 'D', 'W', 'W', 'W']);
  });

  it('sin racha, "gana X de cada Y"', () => {
    const ms = [m(true, 3, 1, 1), m(false, 1, 3, 2)];
    expect(teamStatsStory(stats({ played: 7, won: 3 }), ms, T, { locale: 'es' }).headline.title).toBe('Gana 3 de cada 7 partidos');
  });

  it('casa contra fuera: detecta dónde es más fuerte', () => {
    const ms = [m(true, 5, 1, 1), m(true, 4, 2, 2), m(false, 1, 3, 3), m(false, 2, 2, 4)];
    const s = teamStatsStory(stats(), ms, T, { locale: 'es' });
    expect(s.results.home).toEqual({ w: 2, d: 0, l: 0 });
    expect(s.results.venue).toBe('Mucho más fuerte en casa: suma el 100 % de los puntos posibles, por el 17 % fuera.');
  });

  it('ataque, defensa y mayor victoria', () => {
    const ms = [m(true, 3, 2, 1), m(false, 6, 2, 2, 'IGUALADA RIGAT')];
    const s = teamStatsStory(stats(), ms, T, { locale: 'es' });
    expect(s.scoring.sentence).toBe('Marca 4,0 goles por partido y encaja 2,0. Diferencia de goles: +12.');
    expect(s.scoring.biggestWin?.text).toBe('Mayor victoria: 6-2 ante Igualada Rigat.');
  });

  it('disciplina y bola parada en frase', () => {
    const s = teamStatsStory(stats(), [], T, { locale: 'es' });
    expect(s.discipline.sentence).toBe('10,0 faltas por partido, una azul cada 2,0 partidos.');
    expect(s.setPieces.sentence).toBe('Penaltis: 1/2 (50 %) · faltas directas: 2/4 (50 %).');
  });

  it('sin penaltis ni directas no hay frase de bola parada', () => {
    const s = teamStatsStory(stats({ penalties: { total: 0, scored: 0, pct: null }, directFouls: { total: 0, scored: 0, pct: null } }), [], T, { locale: 'en' });
    expect(s.setPieces.sentence).toBeNull();
  });
});
