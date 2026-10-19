import { describe, it, expect, afterEach } from 'vitest';
import type { Context } from 'hono';
import {
  isMeteredReadPath,
  entityRefFromPath,
  isCrawlerUserAgent,
  isInternalRequest,
  ConcurrencyLimiter,
  EnumerationTracker,
} from './read-guard.js';

const ID = '0073f9aa-1111-4222-8333-444455556666';

describe('isMeteredReadPath', () => {
  it('incluye las lecturas de datos', () => {
    expect(isMeteredReadPath('GET', '/competitions')).toBe(true);
    expect(isMeteredReadPath('GET', `/competitions/${ID}/seasons`)).toBe(true);
    expect(isMeteredReadPath('GET', `/seasons/${ID}/overview`)).toBe(true);
    expect(isMeteredReadPath('GET', `/seasons/${ID}/matches`)).toBe(true);
    expect(isMeteredReadPath('GET', `/matches/${ID}`)).toBe(true);
    expect(isMeteredReadPath('GET', `/teams/${ID}`)).toBe(true);
    expect(isMeteredReadPath('GET', `/teams/${ID}/recent`)).toBe(true);
    expect(isMeteredReadPath('GET', `/players/${ID}/insights`)).toBe(true);
    expect(isMeteredReadPath('GET', '/search')).toBe(true);
    expect(isMeteredReadPath('GET', '/meta/sitemap')).toBe(true);
  });

  it('excluye SSE, imágenes, health y métodos no-GET', () => {
    expect(isMeteredReadPath('GET', `/matches/${ID}/stream`)).toBe(false);
    expect(isMeteredReadPath('GET', `/teams/${ID}/logo`)).toBe(false);
    expect(isMeteredReadPath('GET', `/players/${ID}/photo`)).toBe(false);
    expect(isMeteredReadPath('GET', '/health')).toBe(false);
    expect(isMeteredReadPath('POST', `/matches/${ID}`)).toBe(false);
  });
});

describe('entityRefFromPath', () => {
  it('extrae la entidad de las rutas con UUID', () => {
    expect(entityRefFromPath(`/matches/${ID}`)).toEqual({ kind: 'match', id: ID });
    expect(entityRefFromPath(`/teams/${ID}/recent`)).toEqual({ kind: 'team', id: ID });
    expect(entityRefFromPath(`/players/${ID}/insights`)).toEqual({ kind: 'player', id: ID });
    expect(entityRefFromPath(`/seasons/${ID}/overview`)).toEqual({ kind: 'season', id: ID });
  });

  it('ignora rutas sin UUID (live/current, basura, competiciones)', () => {
    expect(entityRefFromPath('/matches/live')).toBeNull();
    expect(entityRefFromPath('/matches/current')).toBeNull();
    expect(entityRefFromPath('/matches/not-a-uuid')).toBeNull();
    expect(entityRefFromPath(`/competitions/${ID}`)).toBeNull();
  });
});

describe('isCrawlerUserAgent', () => {
  it('reconoce crawlers declarados y no confunde navegadores', () => {
    expect(isCrawlerUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isCrawlerUserAgent('bingbot/2.0')).toBe(true);
    expect(isCrawlerUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120')).toBe(false);
    expect(isCrawlerUserAgent(undefined)).toBe(false);
  });
});

describe('isInternalRequest', () => {
  afterEach(() => {
    delete process.env['INTERNAL_API_TOKEN'];
  });

  const ctx = (token?: string): Context => ({
    req: { header: (k: string) => (k === 'x-internal-token' ? token : undefined) },
  }) as unknown as Context;

  it('solo acepta el token exacto', () => {
    process.env['INTERNAL_API_TOKEN'] = 'secreto-interno';
    expect(isInternalRequest(ctx('secreto-interno'))).toBe(true);
    expect(isInternalRequest(ctx('otro'))).toBe(false);
    expect(isInternalRequest(ctx(undefined))).toBe(false);
  });

  it('sin token configurado no hay bypass', () => {
    expect(isInternalRequest(ctx('lo-que-sea'))).toBe(false);
  });
});

describe('ConcurrencyLimiter', () => {
  it('permite hasta el máximo y libera huecos', () => {
    const limiter = new ConcurrencyLimiter(2);
    expect(limiter.acquire('ip')).toBe(true);
    expect(limiter.acquire('ip')).toBe(true);
    expect(limiter.acquire('ip')).toBe(false);
    expect(limiter.count('ip')).toBe(2);
    limiter.release('ip');
    expect(limiter.acquire('ip')).toBe(true);
    expect(limiter.count('ip')).toBe(2);
  });

  it('separa el cupo por clave', () => {
    const limiter = new ConcurrencyLimiter(1);
    expect(limiter.acquire('a')).toBe(true);
    expect(limiter.acquire('b')).toBe(true);
    expect(limiter.acquire('a')).toBe(false);
  });
});

describe('EnumerationTracker', () => {
  it('bloquea al superar el número de entidades distintas de la ventana', () => {
    const tracker = new EnumerationTracker(10_000, 2, 5_000);
    const ref = (id: string) => ({ kind: 'match' as const, id });

    expect(tracker.check('ip', ref('a'), 1_000)).toMatchObject({ blocked: false, distinct: 1 });
    expect(tracker.check('ip', ref('b'), 1_001)).toMatchObject({ blocked: false, distinct: 2 });
    expect(tracker.check('ip', ref('c'), 1_002)).toMatchObject({ blocked: true, distinct: 3 });

    // Mientras dura el bloqueo, cualquier entidad se rechaza.
    expect(tracker.check('ip', ref('a'), 2_000)).toMatchObject({
      blocked: true,
      retryAfterSeconds: 5,
    });
    expect(tracker.blockedCount()).toBe(1);
  });

  it('al caducar el bloqueo vuelve a contar desde cero', () => {
    const tracker = new EnumerationTracker(10_000, 1, 5_000);
    const ref = (id: string) => ({ kind: 'team' as const, id });

    expect(tracker.check('ip', ref('a'), 1_000).blocked).toBe(false);
    expect(tracker.check('ip', ref('b'), 1_001).blocked).toBe(true);
    expect(tracker.check('ip', ref('c'), 6_001)).toMatchObject({ blocked: false, distinct: 1 });
  });

  it('olvida entidades fuera de la ventana deslizante', () => {
    const tracker = new EnumerationTracker(1_000, 2, 5_000);
    const ref = (id: string) => ({ kind: 'season' as const, id });

    expect(tracker.check('ip', ref('a'), 1_000).distinct).toBe(1);
    expect(tracker.check('ip', ref('b'), 3_000).distinct).toBe(1); // 'a' ya caducó
    expect(tracker.check('ip', ref('c'), 3_001).blocked).toBe(false); // b+c = 2
    expect(tracker.check('ip', ref('d'), 3_002).blocked).toBe(true);  // 3 > 2
  });

  it('cleanup elimina bloqueos y entradas caducadas', () => {
    const tracker = new EnumerationTracker(1_000, 1, 2_000);
    const ref = (id: string) => ({ kind: 'player' as const, id });

    tracker.check('ip', ref('a'), 1_000);
    tracker.check('ip', ref('b'), 1_001);
    expect(tracker.blockedCount()).toBe(1);
    tracker.cleanup(10_000);
    expect(tracker.blockedCount()).toBe(0);
    expect(tracker.trackedCount()).toBe(0);
  });
});
