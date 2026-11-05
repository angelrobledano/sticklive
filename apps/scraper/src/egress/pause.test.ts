import { describe, expect, it } from 'vitest';
import { isSidgadPaused } from './pause.js';

describe('isSidgadPaused', () => {
  it('solo pausa con un valor afirmativo', () => {
    expect(isSidgadPaused({})).toBe(false);
    expect(isSidgadPaused({ SIDGAD_PAUSED: '0' })).toBe(false);
    expect(isSidgadPaused({ SIDGAD_PAUSED: '' })).toBe(false);
    expect(isSidgadPaused({ SIDGAD_PAUSED: '1' })).toBe(true);
    expect(isSidgadPaused({ SIDGAD_PAUSED: ' TRUE ' })).toBe(true);
  });
});
