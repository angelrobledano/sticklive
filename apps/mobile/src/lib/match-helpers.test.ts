import { describe, expect, it } from 'vitest';
import {
  toTitleCase,
  playerFullName,
  displayLineupName,
  eventSurname,
  fmtEventClock,
  finalLabelKey,
  penaltyText,
  injectPeriodDividers,
  injectAccumulatedFouls,
  compareTimelineEvents,
  visibleTabsFor,
  formatTime,
  formatDate,
} from './match-helpers';
import type { MatchDetail, MatchStats } from './api/types';

describe('match-helpers', () => {
  describe('name formatting', () => {
    it('toTitleCase capitalizes words properly', () => {
      expect(toTitleCase('IGLESIAS PEREZ')).toBe('Iglesias Perez');
      expect(toTitleCase('pau bargallo')).toBe('Pau Bargallo');
    });

    it('playerFullName converts firstName and single surname', () => {
      expect(playerFullName({ firstName: 'IGNACIO', lastName: 'ALABART GONZALEZ' })).toBe(
        'Ignacio Alabart'
      );
      expect(playerFullName(null)).toBe('');
    });

    it('displayLineupName extracts first name and surname', () => {
      expect(displayLineupName('ALABART GONZALEZ IGNACIO')).toBe('Ignacio Alabart');
      expect(displayLineupName('BARGALLO PAU')).toBe('Pau Bargallo');
      expect(displayLineupName('NIL')).toBe('Nil');
    });

    it('eventSurname extracts short surname', () => {
      expect(eventSurname({ firstName: 'IGNACIO', lastName: 'ALABART GONZALEZ' })).toBe('Alabart');
    });
  });

  describe('clock and date formatting', () => {
    it('fmtEventClock returns clock or formats remaining minutes', () => {
      expect(fmtEventClock({ clock: '12:34', minute: 13 })).toBe('12:34');
      expect(fmtEventClock({ clock: null, minute: 10 })).toBe('15:00');
      expect(fmtEventClock({ clock: null, minute: null })).toBe('–:–');
    });

    it('formatTime formats ISO string in timezone', () => {
      const iso = '2026-10-21T18:45:00Z';
      const time = formatTime(iso, 'Europe/Madrid', 'es');
      expect(time).toMatch(/\d{2}:\d{2}/);
    });

    it('formatDate formats ISO string in timezone', () => {
      const iso = '2026-10-21T18:45:00Z';
      const date = formatDate(iso, 'Europe/Madrid', 'es');
      expect(date).toContain('21');
    });
  });

  describe('result labels', () => {
    it('finalLabelKey returns correct keys for win types', () => {
      expect(finalLabelKey('overtime')).toBe('match_states.final_overtime');
      expect(finalLabelKey('penalties')).toBe('match_states.final_penalties');
      expect(finalLabelKey('regular')).toBe('match_states.final');
      expect(finalLabelKey(null)).toBe('match_states.final');
    });

    it('penaltyText returns string score or null', () => {
      expect(penaltyText({ home: 3, away: 2 })).toBe('3 - 2');
      expect(penaltyText(null)).toBeNull();
      expect(penaltyText({ home: null, away: null })).toBeNull();
    });
  });

  describe('timeline helpers', () => {
    it('injectPeriodDividers adds period dividers', () => {
      const events: any[] = [
        { id: '1', period: 1, minute: 5, eventType: 'goal' },
        { id: '2', period: 1, minute: 15, eventType: 'foul' },
        { id: '3', period: 2, minute: 3, eventType: 'goal' },
      ];
      const withDividers = injectPeriodDividers(events);
      expect(withDividers.length).toBe(5);
      expect(withDividers[0]?.eventType).toBe('period_divider');
      expect((withDividers[0] as any).period).toBe(1);
      expect(withDividers[3]?.eventType).toBe('period_divider');
      expect((withDividers[3] as any).period).toBe(2);
    });

    it('injectAccumulatedFouls adds virtual accumulated foul events at 10, 15, 20 fouls', () => {
      const homeId = 'team-home';
      const events: any[] = [];
      for (let i = 1; i <= 11; i++) {
        events.push({
          id: `foul-${i}`,
          eventType: 'foul',
          teamId: homeId,
          minute: i,
          period: 1,
        });
      }
      const result = injectAccumulatedFouls(events, homeId);
      // 11 fouls + 1 accumulated foul at 10th foul = 12 items
      expect(result.length).toBe(12);
      const acc = result.find((e) => e.eventType === 'accumulated_foul');
      expect(acc).toBeDefined();
      expect((acc as any)?.foulNumber).toBe(10);
    });

    it('compareTimelineEvents sorts by period asc, then remaining clock desc', () => {
      const a = { period: 1, clock: '20:00', minute: 5 };
      const b = { period: 1, clock: '15:00', minute: 10 };
      const c = { period: 2, clock: '24:00', minute: 1 };
      expect(compareTimelineEvents(a, b)).toBeLessThan(0); // 20:00 left is earlier than 15:00 left
      expect(compareTimelineEvents(a, c)).toBeLessThan(0); // period 1 before period 2
    });
  });

  describe('visibleTabsFor', () => {
    const dummyStats: MatchStats = {
      homeFouls: 0,
      awayFouls: 0,
      homeGoals: 0,
      awayGoals: 0,
      homeAssists: 0,
      awayAssists: 0,
      homeBlueCards: 0,
      awayBlueCards: 0,
      homeRedCards: 0,
      awayRedCards: 0,
      homeTimeouts: 0,
      awayTimeouts: 0,
      homeDirectFouls: { total: 0, scored: 0 },
      awayDirectFouls: { total: 0, scored: 0 },
      homePenalties: { total: 0, scored: 0 },
      awayPenalties: { total: 0, scored: 0 },
    };

    it('returns only Resumen when scheduled without lineups or stats', () => {
      const data: MatchDetail = {
        match: {
          id: '1',
          seasonId: 's1',
          roundId: null,
          competitionId: 'c1',
          competitionName: 'Liga',
          competitionSlug: 'liga',
          competitionTimezone: null,
          status: 'scheduled',
          eventCoverage: 'full',
          scheduledAt: '2026-10-21T20:00:00Z',
          startedAt: null,
          finishedAt: null,
          score: { home: null, away: null },
          winType: null,
          winnerTeamId: null,
          regulation: null,
          penalties: null,
          penaltyShootout: null,
          venue: null,
          referee: null,
          sourceRef: null,
          videoUrl: null,
          live: null,
          homeTeam: { id: 'h1', name: 'Home', shortName: 'H', logoUrl: null },
          awayTeam: { id: 'a1', name: 'Away', shortName: 'A', logoUrl: null },
        },
        events: [],
        stats: dummyStats,
        lineups: { home: [], away: [] },
      };
      expect(visibleTabsFor(data)).toEqual(['Resumen']);
    });

    it('includes Alineaciones when lineups are present', () => {
      const data: MatchDetail = {
        match: { status: 'scheduled' } as any,
        events: [],
        stats: dummyStats,
        lineups: {
          home: [{ playerName: 'Player 1', isStarter: true } as any],
          away: [],
        },
      };
      expect(visibleTabsFor(data)).toContain('Alineaciones');
    });

    it('includes Estadísticas when match has started and has stats or events', () => {
      const data: MatchDetail = {
        match: { status: 'live' } as any,
        events: [{ id: '1' } as any],
        stats: { ...dummyStats, homeGoals: 1 },
        lineups: { home: [], away: [] },
      };
      expect(visibleTabsFor(data)).toContain('Estadísticas');
    });
  });
});
