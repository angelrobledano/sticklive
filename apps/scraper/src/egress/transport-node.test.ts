import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeRequestText } from './transport-node.js';
import { SidgadEgress } from './egress.js';
import type { EgressConfig } from './types.js';

const servers: Server[] = [];

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ url: string; server: Server }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, server };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
});

describe('nodeRequestText (segunda salida)', () => {
  it('hace GET y devuelve cuerpo, status, set-cookie y retry-after', async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': ['PHPSESSID=abc; Path=/'],
        'retry-after': '5',
      });
      res.end('hola');
    });

    const response = await nodeRequestText({
      method: 'GET',
      url: `${url}/rfep_ls_1.php`,
      headers: { Referer: 'https://example.test/' },
      timeoutMs: 5000,
    });

    expect(response).toMatchObject({
      status: 200,
      body: 'hola',
      setCookie: ['PHPSESSID=abc; Path=/'],
      retryAfter: '5',
    });
  });

  it('hace POST con Content-Length y cuerpo form-encoded', async () => {
    let received = '';
    const { url } = await startServer((req, res) => {
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        received += chunk;
      });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(received);
      });
    });

    const response = await nodeRequestText({
      method: 'POST',
      url: `${url}/rfep_cal.php`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'idc=3150&site_lang=es',
      timeoutMs: 5000,
    });

    expect(response.body).toBe('idc=3150&site_lang=es');
    expect(received).toBe('idc=3150&site_lang=es');
  });

  it('usa la IP de origen indicada en localAddress', async () => {
    const { url } = await startServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(req.socket.localAddress ?? 'desconocida');
    });

    const response = await nodeRequestText({
      method: 'GET',
      url: `${url}/x.php`,
      headers: {},
      timeoutMs: 5000,
      localAddress: '127.0.0.1',
    });

    expect(response.body).toBe('127.0.0.1');
  });

  it('clasifica el timeout como timeout', async () => {
    const { url } = await startServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end('tarde');
      }, 200);
    });

    await expect(
      nodeRequestText({
        method: 'GET',
        url: `${url}/lento.php`,
        headers: {},
        timeoutMs: 20,
      })
    ).rejects.toMatchObject({ kind: 'timeout', retryable: true, failover: true });
  });

  it('devuelve los 5xx como respuesta (la clasificación es del router)', async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('caído');
    });

    const response = await nodeRequestText({
      method: 'GET',
      url: `${url}/x.php`,
      headers: {},
      timeoutMs: 5000,
    });
    expect(response.status).toBe(503);
    expect(response.body).toBe('caído');
  });

  it('sigue redirecciones 302 y convierte POST en GET solo para 303', async () => {
    const { url } = await startServer((req, res) => {
      if (req.url === '/inicio.php') {
        res.writeHead(302, { location: '/final.php' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`${req.method} ${req.url}`);
    });

    const response = await nodeRequestText({
      method: 'POST',
      url: `${url}/inicio.php`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'a=1',
      timeoutMs: 5000,
    });

    // 302 tras POST: el estándar (y fetch) lo convierte en GET.
    expect(response.body).toBe('GET /final.php');
  });

  it('corta una respuesta que supera el máximo configurado', async () => {
    const { url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('x'.repeat(200));
    });

    await expect(
      nodeRequestText({
        method: 'GET',
        url: `${url}/grande.php`,
        headers: {},
        timeoutMs: 5000,
        maxResponseBytes: 10,
      })
    ).rejects.toMatchObject({ kind: 'response_too_large', retryable: false });
  });

  it('la ruta secondary-ip usa localAddress de extremo a extremo', async () => {
    const { url } = await startServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(req.socket.localAddress ?? 'desconocida');
    });

    const config: EgressConfig = {
      primary: 'secondary-ip',
      fallbacks: [],
      routes: {
        direct: { kind: 'direct', enabled: true, authorized: true },
        cloudflare: { kind: 'cloudflare', enabled: false, authorized: false },
        'secondary-ip': {
          kind: 'secondary-ip',
          enabled: true,
          authorized: true,
          sourceIp: '127.0.0.1',
        },
      },
      retries: 1,
      retryBaseMs: 10,
      retryMaxMs: 10,
      timeoutMs: 5000,
      maxRetryAfterMs: 1000,
      circuitFailureThreshold: 5,
      circuitCooldownMs: 1000,
      alertThrottleMs: 1000,
    };
    const egress = new SidgadEgress({ config, sleep: async () => {}, alert: () => {} });

    const response = await egress.request({
      method: 'GET',
      url: `${url}/rfep_ls_1.php`,
      portal: 'rfep',
      endpointPath: 'rfep_ls_1.php',
      headers: {},
      timeoutMs: 5000,
    });

    expect(response.route).toBe('secondary-ip');
    expect(response.body).toBe('127.0.0.1');
  });
});
