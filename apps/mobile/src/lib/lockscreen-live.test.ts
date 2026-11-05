import { describe, expect, it, vi } from 'vitest';
import type { MatchSummary } from './api/types';
import {
  buildLockScreenNotification,
  getFollowedLiveMatches,
  getNotificationIdForMatch,
  isMatchFollowed,
  syncLockScreenLiveMatches,
} from './lockscreen-live';

vi.mock('expo-notifications', () => ({
  AndroidNotificationPriority: {
    HIGH: 'high',
    MAX: 'max',
  },
}));

const makeMatch = (overrides?: Partial<MatchSummary>): MatchSummary => ({
  id: 'match-1',
  seasonId: 'season-1',
  roundId: 'round-1',
  competitionId: 'comp-ok-liga',
  competitionName: 'Parlem OK Liga',
  competitionSlug: 'parlem-ok-liga',
  competitionTimezone: 'Europe/Madrid',
  status: 'live',
  isHalftime: false,
  winType: null,
  winnerTeamId: null,
  penalties: null,
  scheduledAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  finishedAt: null,
  homeTeamId: 'team-barca',
  awayTeamId: 'team-liceo',
  sourceRef: null,
  venue: { name: 'Palau Blaugrana', city: 'Barcelona' },
  score: { home: 3, away: 2 },
  homeTeam: { id: 'team-barca', name: 'Barça', shortName: 'BAR', logoUrl: null },
  awayTeam: { id: 'team-liceo', name: 'Deportivo Liceo', shortName: 'LIC', logoUrl: null },
  ...overrides,
});

describe('lockscreen-live', () => {
  describe('isMatchFollowed', () => {
    it('detecta seguimiento por equipo local o visitante', () => {
      const match = makeMatch();
      expect(isMatchFollowed(match, { teams: ['team-barca'], leagues: [] })).toEqual({
        isFollowed: true,
        reason: 'team',
      });
      expect(isMatchFollowed(match, { teams: ['team-liceo'], leagues: [] })).toEqual({
        isFollowed: true,
        reason: 'team',
      });
    });

    it('detecta seguimiento por liga', () => {
      const match = makeMatch({ competitionId: 'comp-ok-liga' });
      expect(isMatchFollowed(match, { teams: [], leagues: ['comp-ok-liga'] })).toEqual({
        isFollowed: true,
        reason: 'league',
      });
    });

    it('detecta seguimiento por jugador (equipo del jugador en el partido)', () => {
      const match = makeMatch();
      expect(
        isMatchFollowed(match, {
          teams: [],
          leagues: [],
          playerTeams: ['team-barca'],
        }),
      ).toEqual({
        isFollowed: true,
        reason: 'player',
      });
    });

    it('devuelve false cuando no coincide ninguna entidad', () => {
      const match = makeMatch();
      expect(
        isMatchFollowed(match, {
          teams: ['team-reus'],
          leagues: ['comp-silver'],
          playerTeams: ['team-voltreg'],
        }),
      ).toEqual({
        isFollowed: false,
      });
    });
  });

  describe('getFollowedLiveMatches', () => {
    it('devuelve solo partidos que están en vivo Y coinciden con seguidos', () => {
      const liveFollowed = makeMatch({ id: 'm-live-fav', status: 'live' });
      const liveNotFollowed = makeMatch({
        id: 'm-live-other',
        status: 'live',
        competitionId: 'other-comp',
        homeTeam: { id: 'other-1', name: 'Otro 1', shortName: null, logoUrl: null },
        awayTeam: { id: 'other-2', name: 'Otro 2', shortName: null, logoUrl: null },
      });
      const finishedFollowed = makeMatch({ id: 'm-finished-fav', status: 'finished' });
      const scheduledFollowed = makeMatch({ id: 'm-sched-fav', status: 'scheduled' });

      const matches = [liveFollowed, liveNotFollowed, finishedFollowed, scheduledFollowed];
      const followed = { teams: ['team-barca'], leagues: [] };

      const result = getFollowedLiveMatches(matches, followed);
      expect(result.map((m) => m.id)).toEqual(['m-live-fav']);
    });

    it('devuelve array vacío si matches es nulo o vacío', () => {
      expect(getFollowedLiveMatches(null, { teams: [], leagues: [] })).toEqual([]);
      expect(getFollowedLiveMatches([], { teams: [], leagues: [] })).toEqual([]);
    });
  });

  describe('buildLockScreenNotification', () => {
    it('genera el payload para la pantalla de bloqueo con marcador y deep link', () => {
      const match = makeMatch({
        id: 'm123',
        competitionName: 'OK Liga',
        score: { home: 4, away: 1 },
      });

      const notification = buildLockScreenNotification(match);

      expect(notification.identifier).toBe('live-match-m123');
      expect(notification.content.title).toBe('🔴 OK Liga · En directo');
      expect(notification.content.body).toBe('Barça 4 - 1 Deportivo Liceo');
      expect(notification.content.sticky).toBe(true);
      expect(notification.content.autoDismiss).toBe(false);
      expect(notification.content.priority).toBe('high');
      expect(notification.content.data).toEqual({
        type: 'live_lockscreen',
        matchId: 'm123',
        urlPath: '/match/m123',
      });
    });

    it('indica Descanso en el título si el partido está en el descanso', () => {
      const match = makeMatch({
        isHalftime: true,
        status: 'live',
      });

      const notification = buildLockScreenNotification(match);
      expect(notification.content.title).toContain('Descanso');
    });
  });

  describe('getNotificationIdForMatch', () => {
    it('genera un id consistente con prefijo live-match-', () => {
      expect(getNotificationIdForMatch('abc-456')).toBe('live-match-abc-456');
    });
  });

  describe('syncLockScreenLiveMatches', () => {
    it('programa notificación cuando hay partido live y seguido', () => {
      const scheduleMock = vi.fn();
      const dismissMock = vi.fn();
      const match = makeMatch({ id: 'm1', status: 'live' });

      const newIds = syncLockScreenLiveMatches({
        platform: 'android',
        isEnabled: true,
        matches: [match],
        followed: { teams: ['team-barca'], leagues: [] },
        activeMatchIds: new Set(),
        channelId: 'test_channel',
        scheduleNotification: scheduleMock,
        dismissNotification: dismissMock,
      });

      expect(newIds).toEqual(new Set(['m1']));
      expect(scheduleMock).toHaveBeenCalledWith(
        'live-match-m1',
        expect.objectContaining({ title: expect.stringContaining('En directo') }),
        'test_channel',
      );
      expect(dismissMock).not.toHaveBeenCalled();
    });

    it('descarta notificación cuando el partido deja de estar en vivo', () => {
      const scheduleMock = vi.fn();
      const dismissMock = vi.fn();
      const match = makeMatch({ id: 'm1', status: 'finished' });

      const newIds = syncLockScreenLiveMatches({
        platform: 'android',
        isEnabled: true,
        matches: [match],
        followed: { teams: ['team-barca'], leagues: [] },
        activeMatchIds: new Set(['m1']),
        channelId: 'test_channel',
        scheduleNotification: scheduleMock,
        dismissNotification: dismissMock,
      });

      expect(newIds).toEqual(new Set());
      expect(scheduleMock).not.toHaveBeenCalled();
      expect(dismissMock).toHaveBeenCalledWith('live-match-m1');
    });

    it('descarta todas las notificaciones si isEnabled es false o no es Android', () => {
      const dismissMock = vi.fn();
      const match = makeMatch({ id: 'm1', status: 'live' });

      const newIds = syncLockScreenLiveMatches({
        platform: 'android',
        isEnabled: false,
        matches: [match],
        followed: { teams: ['team-barca'], leagues: [] },
        activeMatchIds: new Set(['m1', 'm2']),
        channelId: 'test_channel',
        scheduleNotification: vi.fn(),
        dismissNotification: dismissMock,
      });

      expect(newIds).toEqual(new Set());
      expect(dismissMock).toHaveBeenCalledWith('live-match-m1');
      expect(dismissMock).toHaveBeenCalledWith('live-match-m2');
    });
  });
});
