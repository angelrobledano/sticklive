import { describe, it, expect } from 'vitest';
import type { SeasonMatch, SeasonOverview } from '@/lib/api/client';
import { competitionVisibleTabs } from './CompetitionClient';

/**
 * Spec 2026-10-16 (referencia FotMob): en cuanto la fase final manda, el cuadro
 * es la primera pestaña y la que se abre por defecto. Antes, orden de siempre.
 */

let n = 0;
function match(roundType: 'regular' | 'playoff', status: string): SeasonMatch {
  const t = (id: string) => ({ id, name: id, shortName: id, logoUrl: null });
  return {
    id: `m${++n}`, status, scheduledAt: '2026-10-15T18:00:00Z', startedAt: null, finishedAt: null,
    score: { home: null, away: null }, venueName: null, roundId: null, roundNumber: 1, roundName: null,
    roundType, homeTeam: t('a'), awayTeam: t('b'),
  };
}

const standings = [{ teamId: 't1' }] as unknown as SeasonOverview['standings'];
const overview = (matches: SeasonMatch[]) =>
  ({ standings, matches, rounds: [] }) as Pick<SeasonOverview, 'standings' | 'matches' | 'rounds'>;

describe('competitionVisibleTabs — el cuadro primero en fase final', () => {
  it('liga en curso: Clasificación, Jornadas (sin cuadro)', () => {
    expect(competitionVisibleTabs(overview([match('regular', 'scheduled')]), null, 'league'))
      .toEqual(['Clasificación', 'Jornadas']);
  });

  it('cruces publicados con la fase regular viva: el cuadro sigue al final', () => {
    expect(competitionVisibleTabs(overview([match('regular', 'scheduled'), match('playoff', 'scheduled')]), null, 'league'))
      .toEqual(['Clasificación', 'Jornadas', 'Playoffs']);
  });

  it('grupos cerrados y eliminatorias en marcha (Mundial): el cuadro primero', () => {
    expect(competitionVisibleTabs(overview([match('regular', 'finished'), match('playoff', 'finished'), match('playoff', 'scheduled')]), null, 'league'))
      .toEqual(['Playoffs', 'Clasificación', 'Jornadas']);
  });
});

describe('competitionVisibleTabs — copas sin tabla de puntos', () => {
  const copa = (rows: Array<{ groupName: string | null }>) =>
    ({ standings: rows.map((r, i) => ({ teamId: `t${i}`, ...r })), matches: [match('playoff', 'finished')], rounds: [] }) as unknown as
      Pick<SeasonOverview, 'standings' | 'matches' | 'rounds'>;

  it('copa a eliminatorias (Supercopa Catalana): solo el cuadro, sin Clasificación', () => {
    expect(competitionVisibleTabs(copa([{ groupName: null }, { groupName: null }]), null, 'bracket')).toEqual(['Playoffs']);
  });

  it('copa con grupos de verdad (Coppa Italia A2): mantiene la Clasificación de los grupos', () => {
    expect(competitionVisibleTabs(copa([{ groupName: 'GIRONE A' }, { groupName: 'GIRONE B' }]), null, 'bracket'))
      .toContain('Clasificación');
  });
});
