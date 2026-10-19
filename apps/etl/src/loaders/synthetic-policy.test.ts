import { describe, it, expect } from 'vitest';
import { keepPastSynthetic } from './synthetic-policy.js';

describe('keepPastSynthetic — placeholders sin idp con fecha pasada', () => {
  it('descarta los de liga sin resultado (cruce que no se jugó)', () => {
    expect(keepPastSynthetic('regular', false)).toBe(false);
    expect(keepPastSynthetic(null, false)).toBe(false);
  });

  it('conserva los de eliminatoria aunque no haya resultado publicado', () => {
    expect(keepPastSynthetic('playoff', false)).toBe(true);
  });

  it('conserva cualquier placeholder con resultado (marcador sin acta)', () => {
    expect(keepPastSynthetic('regular', true)).toBe(true);
    expect(keepPastSynthetic('playoff', true)).toBe(true);
  });
});
