import { describe, expect, it } from 'vitest';
import { shouldShowTodayButton } from './header-helpers';

describe('Header helpers', () => {
  describe('shouldShowTodayButton', () => {
    it('returns false when selectedDate is equal to todayKey', () => {
      expect(shouldShowTodayButton('2026-10-21', '2026-10-21')).toBe(false);
    });

    it('returns true when selectedDate is different from todayKey', () => {
      expect(shouldShowTodayButton('2026-10-20', '2026-10-21')).toBe(true);
      expect(shouldShowTodayButton('2026-10-25', '2026-10-21')).toBe(true);
    });

    it('returns false if either date is empty or null/undefined', () => {
      expect(shouldShowTodayButton('', '2026-10-21')).toBe(false);
      expect(shouldShowTodayButton('2026-10-21', '')).toBe(false);
      expect(shouldShowTodayButton(undefined, '2026-10-21')).toBe(false);
      expect(shouldShowTodayButton('2026-10-21', null)).toBe(false);
    });
  });
});
