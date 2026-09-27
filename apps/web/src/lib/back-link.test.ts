import { describe, it, expect } from 'vitest';
import { shouldReturnToHistory } from './back-link';

describe('shouldReturnToHistory', () => {
  it('vuelve al historial si venimos de una página propia', () => {
    expect(shouldReturnToHistory('https://sticklive.eu/es/competitions', 'https://sticklive.eu')).toBe(true);
  });

  it('usa el fallback si venimos de fuera (p. ej. Google) o no hay referrer', () => {
    expect(shouldReturnToHistory('https://www.google.com/search?q=x', 'https://sticklive.eu')).toBe(false);
    expect(shouldReturnToHistory('', 'https://sticklive.eu')).toBe(false);
    expect(shouldReturnToHistory('no-es-una-url', 'https://sticklive.eu')).toBe(false);
  });
});
