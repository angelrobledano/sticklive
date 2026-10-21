import { describe, expect, it } from 'vitest';
import {
  calcEfficiency,
  halfPositions,
  placeRinkPlayers,
  type RinkPlayer,
} from '@/src/lib/match-helpers';

describe('PenaltyShootout and StartingFiveRink helpers', () => {
  describe('calcEfficiency', () => {
    it('returns 0 when total is 0 or negative', () => {
      expect(calcEfficiency(0, 0)).toBe(0);
      expect(calcEfficiency(1, 0)).toBe(0);
      expect(calcEfficiency(2, -1)).toBe(0);
    });

    it('returns exact rounded percentage', () => {
      expect(calcEfficiency(1, 1)).toBe(100);
      expect(calcEfficiency(1, 2)).toBe(50);
      expect(calcEfficiency(2, 3)).toBe(67);
      expect(calcEfficiency(1, 3)).toBe(33);
    });
  });

  describe('Rink formations and positioning', () => {
    it('halfPositions scales correctly based on fieldCount', () => {
      expect(halfPositions(0)).toEqual([]);
      expect(halfPositions(1)).toEqual([{ x: 55, y: 50 }]);
      expect(halfPositions(2)).toEqual([
        { x: 55, y: 32 },
        { x: 55, y: 68 },
      ]);
      expect(halfPositions(3)).toEqual([
        { x: 42, y: 50 },
        { x: 72, y: 28 },
        { x: 72, y: 72 },
      ]);
      expect(halfPositions(4)).toEqual([
        { x: 42, y: 28 },
        { x: 42, y: 72 },
        { x: 74, y: 34 },
        { x: 74, y: 66 },
      ]);
    });

    it('placeRinkPlayers handles teams without a declared goalkeeper', () => {
      const players: RinkPlayer[] = [
        { playerName: 'P1', isGoalkeeper: false, isStarter: true, isCaptain: false, jerseyNumber: 2 },
        { playerName: 'P2', isGoalkeeper: false, isStarter: true, isCaptain: false, jerseyNumber: 3 },
      ];
      const placed = placeRinkPlayers(players, false);
      expect(placed).toHaveLength(2);
      expect(placed.every((p) => !p.p.isGoalkeeper)).toBe(true);
    });

    it('placeRinkPlayers mirrors away team horizontally around center line', () => {
      const homePlayers: RinkPlayer[] = [
        { playerName: 'GK', isGoalkeeper: true, isStarter: true, isCaptain: false, jerseyNumber: 1 },
      ];
      const awayPlayers: RinkPlayer[] = [
        { playerName: 'GK', isGoalkeeper: true, isStarter: true, isCaptain: false, jerseyNumber: 1 },
      ];
      const placedHome = placeRinkPlayers(homePlayers, false);
      const placedAway = placeRinkPlayers(awayPlayers, true);

      // Home GK is at 11%, Away GK is mirrored at 100 - 11 = 89%
      expect(placedHome[0]?.x).toBe(11);
      expect(placedAway[0]?.x).toBe(89);
      expect(placedHome[0]?.y).toBe(placedAway[0]?.y);
    });
  });
});
