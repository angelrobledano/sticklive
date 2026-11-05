import { describe, expect, it } from 'vitest';
import { CORE_SMOKE } from './smoke';

describe('core smoke', () => {
  it('exporta la marca de humo', () => {
    expect(CORE_SMOKE).toBe('sports-core');
  });
});
