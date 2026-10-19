import { describe, it, expect } from 'vitest';
import { resolveTheme, storedTheme } from './theme';

describe('preferencia de tema', () => {
  it('sin valor guardado se sigue el sistema', () => {
    expect(storedTheme(null)).toBe('system');
  });

  it('valores guardados válidos se respetan', () => {
    expect(storedTheme('light')).toBe('light');
    expect(storedTheme('dark')).toBe('dark');
    expect(storedTheme('system')).toBe('system');
  });

  it('un valor corrupto cae en sistema, no en un tema fijo', () => {
    expect(storedTheme('neon')).toBe('system');
  });

  it('sistema resuelve según la preferencia del SO', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('una elección explícita gana sobre el sistema', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
