import { describe, it, expect } from 'vitest';
import { cacheControlFor } from './read-cache.js';

describe('cacheControlFor (I1)', () => {
  it('cachea el listado y el detalle de competiciones (largo)', () => {
    expect(cacheControlFor('GET', '/competitions')).toMatch(/max-age=300/);
    expect(cacheControlFor('GET', '/competitions/ok-liga')).toMatch(/max-age=300/);
  });

  it('cachea standings/overview/stats de temporada (60 s)', () => {
    for (const p of ['/seasons/abc/standings', '/seasons/abc/overview', '/seasons/abc/stats']) {
      expect(cacheControlFor('GET', p)).toMatch(/max-age=60/);
    }
  });

  it('cachea team-detail y player-detail (60 s)', () => {
    expect(cacheControlFor('GET', '/teams/abc')).toMatch(/max-age=60/);
    expect(cacheControlFor('GET', '/players/abc')).toMatch(/max-age=60/);
  });

  it('cachea match-detail (30 s)', () => {
    expect(cacheControlFor('GET', '/matches/abc')).toMatch(/max-age=30/);
  });

  it('NO cachea el stream SSE (2 segmentos)', () => {
    expect(cacheControlFor('GET', '/matches/abc/stream')).toBeNull();
  });

  it('NO cachea sub-recursos de imagen (logo/photo)', () => {
    expect(cacheControlFor('GET', '/teams/abc/logo')).toBeNull();
    expect(cacheControlFor('GET', '/players/abc/photo')).toBeNull();
  });

  it('NO cachea métodos que no son GET', () => {
    expect(cacheControlFor('POST', '/players/abc')).toBeNull();
    expect(cacheControlFor('GET', '/auth/verify')).toBeNull();
  });
});
