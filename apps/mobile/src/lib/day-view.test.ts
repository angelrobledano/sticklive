import { describe, expect, it } from 'vitest';
import {
  addDaysToKey,
  buildDateKeys,
  buildDayView,
  dayDiff,
  daysWithMatches,
  getRelativeKey,
  madridDateKey,
  nextMatchday,
} from './day-view';
import type { MatchSummary } from './api/types';

function createMatch(
  id: string,
  scheduledAt: string | null,
  compId: string | null = 'okliga',
  compSlug: string | null = 'ok-liga-masculina',
  extra: Partial<MatchSummary> = {},
): MatchSummary {
  return {
    id,
    seasonId: 'season-1',
    roundId: 'round-1',
    competitionId: compId,
    competitionName: compId ? 'OK Liga' : null,
    competitionSlug: compSlug,
    competitionTimezone: 'Europe/Madrid',
    status: 'scheduled',
    isHalftime: false,
    winType: null,
    winnerTeamId: null,
    penalties: null,
    scheduledAt,
    startedAt: null,
    venue: null,
    score: { home: null, away: null },
    homeTeam: { id: `home-${id}`, name: `Home ${id}`, shortName: null, logoUrl: null },
    awayTeam: { id: `away-${id}`, name: `Away ${id}`, shortName: null, logoUrl: null },
    ...extra,
  };
}

describe('day-view date utilities', () => {
  it('madridDateKey formatea a YYYY-MM-DD en hora peninsular de Madrid', () => {
    // 23:30 UTC del día 20 = 01:30 CEST (UTC+2) del día 21 en Madrid
    expect(madridDateKey('2026-10-20T23:30:00Z')).toBe('2026-10-21');
    expect(madridDateKey(null)).toBe('');
  });

  it('addDaysToKey y dayDiff calculan correctamente diferencias y sumas de días', () => {
    expect(addDaysToKey('2026-10-21', 1)).toBe('2026-10-22');
    expect(addDaysToKey('2026-10-21', -1)).toBe('2026-10-20');
    expect(dayDiff('2026-10-22', '2026-10-21')).toBe(1);
    expect(dayDiff('2026-10-20', '2026-10-21')).toBe(-1);
  });

  it('getRelativeKey devuelve claves i18n para ayer, hoy y mañana', () => {
    expect(getRelativeKey('2026-10-21', '2026-10-21')).toBe('common.today');
    expect(getRelativeKey('2026-10-20', '2026-10-21')).toBe('common.yesterday');
    expect(getRelativeKey('2026-10-22', '2026-10-21')).toBe('common.tomorrow');
    expect(getRelativeKey('2026-10-25', '2026-10-21')).toBe(null);
  });

  it('buildDateKeys genera la ventana centrada en todayKey', () => {
    const keys = buildDateKeys('2026-10-21', 2, 2);
    expect(keys).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
    ]);
  });
});

describe('buildDayView', () => {
  const DAY = '2026-10-21';

  it('filtra estrictamente solo los partidos del día seleccionado', () => {
    const matches = [
      createMatch('m-today', '2026-10-21T18:00:00Z'),
      createMatch('m-yesterday', '2026-10-20T18:00:00Z'),
      createMatch('m-tomorrow', '2026-10-22T18:00:00Z'),
    ];
    const view = buildDayView(matches, { dayKey: DAY });
    expect(view.total).toBe(1);
    expect(view.competitions[0]?.matches.map((m) => m.id)).toEqual(['m-today']);
  });

  it('ordena partidos de cada competición por hora de inicio cronológica', () => {
    const matches = [
      createMatch('late', '2026-10-21T20:00:00Z'),
      createMatch('early', '2026-10-21T12:00:00Z'),
      createMatch('mid', '2026-10-21T16:00:00Z'),
    ];
    const view = buildDayView(matches, { dayKey: DAY });
    expect(view.competitions[0]?.matches.map((m) => m.id)).toEqual(['early', 'mid', 'late']);
  });

  it('separa partidos de equipos seguidos en myTeams', () => {
    const followedMatch = createMatch('fav', '2026-10-21T15:00:00Z', 'okliga', 'ok-liga-masculina', {
      homeTeam: { id: 'team-barca', name: 'Barça', shortName: 'FCB', logoUrl: null },
    });
    const otherMatch = createMatch('other', '2026-10-21T16:00:00Z');

    const view = buildDayView([followedMatch, otherMatch], { dayKey: DAY, teamIds: ['team-barca'] });
    expect(view.myTeams.map((m) => m.id)).toEqual(['fav']);
    expect(view.competitions[0]?.matches.map((m) => m.id)).toEqual(['other']);
  });

  it('cuenta partidos en directo y aplica filtro live', () => {
    const liveMatch = createMatch('live-1', '2026-10-21T18:00:00Z', 'okliga', 'ok-liga-masculina', {
      status: 'live',
    });
    const schedMatch = createMatch('sched-1', '2026-10-21T19:00:00Z');

    const view = buildDayView([liveMatch, schedMatch], { dayKey: DAY, filter: 'live' });
    expect(view.total).toBe(2);
    expect(view.liveCount).toBe(1);
    expect(view.filter).toBe('live');
    expect(view.competitions[0]?.matches.map((m) => m.id)).toEqual(['live-1']);
  });

  it('daysWithMatches identifica los días con partidos', () => {
    const matches = [
      createMatch('m1', '2026-10-21T18:00:00Z'),
      createMatch('m2', '2026-10-25T18:00:00Z'),
    ];
    const days = daysWithMatches(matches);
    expect(days.has('2026-10-21')).toBe(true);
    expect(days.has('2026-10-25')).toBe(true);
    expect(days.has('2026-10-22')).toBe(false);
  });

  it('nextMatchday encuentra la siguiente jornada con partidos', () => {
    const matches = [
      createMatch('m-past', '2026-10-20T18:00:00Z'),
      createMatch('m-future', '2026-10-24T18:00:00Z'),
    ];
    const next = nextMatchday(matches, '2026-10-21');
    expect(next?.dayKey).toBe('2026-10-24');
    expect(next?.total).toBe(1);
  });
});
