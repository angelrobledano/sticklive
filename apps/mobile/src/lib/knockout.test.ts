import { describe, expect, it } from 'vitest';
import {
  buildKnockoutSummary,
  isKnockoutFormat,
  isKnockoutSeason,
  knockoutPhaseLabel,
  playoffPhaseKey,
  type KnockoutMatchInput,
} from './knockout';

const BAR = 'team-bar';
const HCL = 'team-hcl';
const IHC = 'team-ihc';
const REUS = 'team-reus';

function tm(
  id: string,
  homeId: string,
  awayId: string,
  home: number | null,
  away: number | null,
  scheduledAt: string | null,
  status = 'finished',
  extra: Partial<KnockoutMatchInput> = {},
): KnockoutMatchInput {
  const mk = (tid: string) => ({ id: tid, name: tid, shortName: tid.slice(0, 3).toUpperCase(), logoUrl: null });
  return {
    id,
    status,
    scheduledAt,
    finishedAt: null,
    score: { home, away },
    homeTeam: mk(homeId),
    awayTeam: mk(awayId),
    roundType: 'playoff',
    ...extra,
  };
}

describe('knockout module', () => {
  describe('isKnockoutFormat & isKnockoutSeason', () => {
    it('recognizes bracket and final_four', () => {
      expect(isKnockoutFormat('bracket')).toBe(true);
      expect(isKnockoutFormat('final_four')).toBe(true);
      expect(isKnockoutFormat('league')).toBe(false);
      expect(isKnockoutFormat(null)).toBe(false);
    });

    it('identifies knockout season when format matches', () => {
      expect(isKnockoutSeason({ competitionFormat: 'bracket' }, null, [])).toBe(true);
    });

    it('falls back to inspecting matches when standing is null', () => {
      const matches = [tm('1', BAR, HCL, 2, 1, '2026-10-01T20:00:00Z')];
      expect(isKnockoutSeason(null, null, matches)).toBe(true);
      expect(isKnockoutSeason(null, { points: 10 }, matches)).toBe(false);
    });
  });

  describe('playoffPhaseKey & knockoutPhaseLabel', () => {
    it('identifies phase from string or round number', () => {
      expect(playoffPhaseKey('Cuartos de final', 1)).toBe('quarters');
      expect(playoffPhaseKey('Semifinales', 2)).toBe('semis');
      expect(playoffPhaseKey('Final', 3)).toBe('final');
      expect(playoffPhaseKey('Octavos', null)).toBe('round_of_16');
    });

    it('translates phase label with i18n helper', () => {
      const t = (k: string) => (k === 'playoffs.semis' ? 'Semifinals' : k);
      expect(knockoutPhaseLabel({ phase: 'semis', roundName: 'Semis' }, t)).toBe('Semifinals');
    });
  });

  describe('buildKnockoutSummary', () => {
    const SUP: KnockoutMatchInput[] = [
      tm('s1', REUS, IHC, 3, 5, '2025-09-20T14:15:00Z', 'finished', { roundName: 'FINAL' }),
      tm('s2', BAR, HCL, 5, 2, '2025-09-20T16:45:00Z', 'finished', { roundName: 'FINAL' }),
      tm('s3', IHC, BAR, 1, 3, '2025-09-21T10:15:00Z', 'finished', { roundName: 'FINAL' }),
    ];

    it('builds summary for champion team', () => {
      const summary = buildKnockoutSummary(BAR, SUP);
      expect(summary).not.toBeNull();
      expect(summary?.champion).toBe(true);
      expect(summary?.eliminatedIn).toBeNull();
      expect(summary?.phases).toHaveLength(2); // Semis and Final
      expect(summary?.phases[0].phase).toBe('semis');
      expect(summary?.phases[1].phase).toBe('final');
    });

    it('builds summary for team eliminated in semis', () => {
      const summary = buildKnockoutSummary(HCL, SUP);
      expect(summary).not.toBeNull();
      expect(summary?.champion).toBe(false);
      expect(summary?.eliminatedIn).toBe('semis');
      expect(summary?.phases).toHaveLength(1);
    });

    it('returns null if team has no matches', () => {
      expect(buildKnockoutSummary('unknown-team', SUP)).toBeNull();
      expect(buildKnockoutSummary(BAR, [])).toBeNull();
    });
  });
});
