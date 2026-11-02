import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createWorkerHandler, type WorkerEnv } from '../../../../infra/cloudflare-worker/src/worker.js';
import { buildWorkerPath, signEgressRequest } from './hmac.js';
import { SOURCES } from '../core/sources.js';

const SECRET = 'b'.repeat(64);
const NOW = 1_800_000_000;

const ENV: WorkerEnv = {
  SIDGAD_WORKER_SECRET: SECRET,
  SIDGAD_UPSTREAM_ORIGIN: 'https://www.server2.sidgad.es',
  SIDGAD_ALLOWED_PORTALS: 'rfep,worldskate',
  SIDGAD_MAX_BODY_BYTES: '64',
  SIDGAD_CLOCK_SKEW_SECONDS: '300',
  SIDGAD_REQUEST_TIMEOUT_MS: '1000',
};

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fn, calls };
}

function signedRequest(options: {
  path?: string;
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  timestamp?: number;
  secret?: string;
} = {}): Request {
  const path = options.path ?? '/rfep/rfep_ls_1.php';
  const method = options.method ?? 'GET';
  const body = options.body ?? '';
  const timestamp = String(options.timestamp ?? NOW);
  const signature = signEgressRequest({
    secret: options.secret ?? SECRET,
    timestamp,
    method,
    pathWithQuery: path,
    body,
  });

  const headers = new Headers(options.headers ?? {});
  headers.set('x-sticklive-timestamp', timestamp);
  headers.set('x-sticklive-signature', signature);

  return new Request(`https://worker.example${path}`, {
    method,
    headers,
    ...(method === 'POST' ? { body } : {}),
  });
}

function withNow<T>(fn: () => Promise<T>): Promise<T> {
  const original = Date.now;
  Date.now = () => NOW * 1000;
  return fn().finally(() => {
    Date.now = original;
  });
}

describe('Cloudflare Worker handler', () => {
  it('reenvía una petición firmada y devuelve cuerpo y Set-Cookie', async () => {
    const { fn, calls } = mockFetch(
      () =>
        new Response('hola SIDGAD', {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'set-cookie': 'PHPSESSID=abc; Path=/; HttpOnly',
          },
        })
    );

    const response = await withNow(() =>
      createWorkerHandler(ENV, fn)(
        signedRequest({
          headers: {
            Referer: 'https://www.hockeypatines.fep.es/',
            Cookie: 'PHPSESSID=vieja',
            Authorization: 'Bearer no-debe-pasarse',
            'User-Agent': 'Mozilla/5.0 (test)',
          },
        })
      )
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('hola SIDGAD');
    expect(response.headers.get('x-sticklive-egress')).toBe('cloudflare-worker');
    expect(response.headers.get('set-cookie')).toContain('PHPSESSID=abc');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://www.server2.sidgad.es/rfep/rfep_ls_1.php');
    const forwarded = new Headers(calls[0]!.init?.headers);
    expect(forwarded.get('referer')).toBe('https://www.hockeypatines.fep.es/');
    expect(forwarded.get('cookie')).toBe('PHPSESSID=vieja');
    expect(forwarded.get('user-agent')).toBe('Mozilla/5.0 (test)');
    expect(forwarded.get('authorization')).toBeNull();
    expect(forwarded.get('x-sticklive-signature')).toBeNull();
    expect(forwarded.get('x-sticklive-timestamp')).toBeNull();
  });

  it('rechaza una firma inválida sin hacer subrequest', async () => {
    const { fn, calls } = mockFetch(() => new Response('no'));
    const request = signedRequest({ secret: 'c'.repeat(64) });
    const response = await withNow(() => createWorkerHandler(ENV, fn)(request));

    expect(response.status).toBe(401);
    expect(response.headers.get('x-sticklive-error')).toBe('unauthorized');
    expect(calls).toHaveLength(0);
  });

  it('rechaza un timestamp fuera de la ventana de reloj', async () => {
    const { fn, calls } = mockFetch(() => new Response('no'));
    const response = await withNow(() =>
      createWorkerHandler(ENV, fn)(signedRequest({ timestamp: NOW - 3600 }))
    );

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('rechaza un portal que no está en la lista blanca', async () => {
    const { fn, calls } = mockFetch(() => new Response('no'));
    const response = await withNow(() =>
      createWorkerHandler(ENV, fn)(signedRequest({ path: '/otro/rfep_ls_1.php' }))
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('x-sticklive-error')).toBe('portal_not_allowed');
    expect(calls).toHaveLength(0);
  });

  it('rechaza paths que no son {portal}/{endpoint}.php', async () => {
    const { fn } = mockFetch(() => new Response('no'));

    for (const path of ['/rfep/foo.txt', '/rfep/', '/rfep/sub/x.php', '/rfep/x.php?x=1']) {
      const response = await withNow(() => createWorkerHandler(ENV, fn)(signedRequest({ path })));
      expect(response.status).toBe(400);
    }
  });

  it('rechaza métodos distintos de GET/POST', async () => {
    const { fn } = mockFetch(() => new Response('no'));
    const response = await withNow(() =>
      createWorkerHandler(ENV, fn)(
        new Request('https://worker.example/rfep/rfep_ls_1.php', { method: 'PUT' })
      )
    );
    expect(response.status).toBe(405);
  });

  it('rechaza un cuerpo demasiado grande', async () => {
    const { fn, calls } = mockFetch(() => new Response('no'));
    const body = 'a'.repeat(100);
    const response = await withNow(() =>
      createWorkerHandler(ENV, fn)(
        signedRequest({
          path: '/rfep/rfep_cal.php',
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      )
    );

    expect(response.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it('rechaza un POST con cuerpo y content-type no permitido', async () => {
    const { fn, calls } = mockFetch(() => new Response('no'));
    const body = '{"x":1}';
    const response = await withNow(() =>
      createWorkerHandler(ENV, fn)(
        signedRequest({
          path: '/rfep/rfep_cal.php',
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    expect(response.status).toBe(415);
    expect(calls).toHaveLength(0);
  });

  it('devuelve 504 upstream_timeout si el subrequest expira', async () => {
    const { fn } = mockFetch(() => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    });
    const response = await withNow(() => createWorkerHandler(ENV, fn)(signedRequest()));

    expect(response.status).toBe(504);
    expect(response.headers.get('x-sticklive-error')).toBe('upstream_timeout');
  });

  it('devuelve 502 upstream_error si el subrequest falla', async () => {
    const { fn } = mockFetch(() => {
      throw new Error('sin red');
    });
    const response = await withNow(() => createWorkerHandler(ENV, fn)(signedRequest()));

    expect(response.status).toBe(502);
    expect(response.headers.get('x-sticklive-error')).toBe('upstream_error');
  });

  it('propaga el status de SIDGAD sin convertirlo en error del Worker', async () => {
    const { fn } = mockFetch(() => new Response('forbidden', { status: 403 }));
    const response = await withNow(() => createWorkerHandler(ENV, fn)(signedRequest()));

    expect(response.status).toBe(403);
    expect(response.headers.get('x-sticklive-error')).toBeNull();
  });

  it('falla cerrado si el Worker no tiene secreto configurado', async () => {
    const { fn, calls } = mockFetch(() => new Response('no'));
    const response = await withNow(() =>
      createWorkerHandler({ ...ENV, SIDGAD_WORKER_SECRET: '' }, fn)(signedRequest())
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('x-sticklive-error')).toBe('worker_misconfigured');
    expect(calls).toHaveLength(0);
  });

  it('la lista blanca de wrangler.toml cubre todos los portales de sources.ts', () => {
    const tomlPath = fileURLToPath(
      new URL('../../../../infra/cloudflare-worker/wrangler.toml', import.meta.url)
    );
    const toml = readFileSync(tomlPath, 'utf8');
    const match = /SIDGAD_ALLOWED_PORTALS\s*=\s*"([^"]+)"/.exec(toml);
    expect(match).not.toBeNull();
    const allowed = new Set(match![1]!.split(',').map((portal) => portal.trim()));

    for (const source of SOURCES) {
      expect(allowed.has(source.client.portalPrefix)).toBe(true);
    }
  });

  it('buildWorkerPath rechaza traversal y URLs absolutas', () => {
    expect(buildWorkerPath('rfep', 'rfep_ls_1.php')).toBe('/rfep/rfep_ls_1.php');
    expect(() => buildWorkerPath('rfep', '../secreto.php')).toThrow();
    expect(() => buildWorkerPath('rfep', 'https://evil.example/x.php')).toThrow();
    expect(() => buildWorkerPath('RFEP MAYUS', 'x.php')).toThrow();
  });
});
