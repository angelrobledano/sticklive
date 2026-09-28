import { describe, it, expect } from 'vitest';
import { buildShareUrl } from './share';

/**
 * #282: el enlace compartido no debe arrastrar parámetros de tracking ni estado
 * interno; solo conserva `season` (identifica una temporada histórica).
 */
describe('buildShareUrl', () => {
  it('elimina los parámetros de tracking', () => {
    expect(buildShareUrl('https://sticklive.eu/es/matches/abc?src=push')).toBe(
      'https://sticklive.eu/es/matches/abc',
    );
    expect(buildShareUrl('https://sticklive.eu/es/matches/abc?src=push&utm_source=x')).toBe(
      'https://sticklive.eu/es/matches/abc',
    );
  });

  it('conserva season y descarta el resto', () => {
    expect(buildShareUrl('https://sticklive.eu/es/competitions/c1?season=s-1&src=push')).toBe(
      'https://sticklive.eu/es/competitions/c1?season=s-1',
    );
  });

  it('descarta el hash', () => {
    expect(buildShareUrl('https://sticklive.eu/es/matches/abc#timeline')).toBe(
      'https://sticklive.eu/es/matches/abc',
    );
  });

  it('ignora season vacío', () => {
    expect(buildShareUrl('https://sticklive.eu/es/competitions/c1?season=')).toBe(
      'https://sticklive.eu/es/competitions/c1',
    );
  });

  it('no toca una URL sin parámetros', () => {
    expect(buildShareUrl('https://sticklive.eu/es/teams/t1')).toBe(
      'https://sticklive.eu/es/teams/t1',
    );
  });

  it('devuelve la entrada tal cual si no es una URL válida', () => {
    expect(buildShareUrl('/es/matches/abc')).toBe('/es/matches/abc');
  });
});
