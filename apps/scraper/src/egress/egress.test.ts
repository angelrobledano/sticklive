import { describe, expect, it } from 'vitest';
import { SidgadEgress } from './egress.js';
import type { EgressAlert } from './alerting.js';
import type {
  EgressConfig,
  EgressRequest,
  EgressRouteConfig,
  EgressTransport,
  RawEgressResponse,
} from './types.js';

function routeConfig(kind: EgressRouteConfig['kind']): EgressRouteConfig {
  if (kind === 'cloudflare') {
    return {
      kind,
      enabled: true,
      authorized: true,
      workerUrl: 'https://sidgad.example.workers.dev',
      workerSecret: 'a'.repeat(64),
    };
  }
  if (kind === 'secondary-ip') {
    return { kind, enabled: true, authorized: true, sourceIp: '203.0.113.10' };
  }
  return { kind, enabled: true, authorized: true };
}

function makeConfig(primary: EgressConfig['primary'], fallbacks: EgressConfig['fallbacks'] = []): EgressConfig {
  return {
    primary,
    fallbacks,
    routes: {
      direct: routeConfig('direct'),
      cloudflare: routeConfig('cloudflare'),
      'secondary-ip': routeConfig('secondary-ip'),
    },
    retries: 3,
    retryBaseMs: 1000,
    retryMaxMs: 30_000,
    timeoutMs: 30_000,
    maxRetryAfterMs: 60_000,
    circuitFailureThreshold: 5,
    circuitCooldownMs: 60_000,
    alertThrottleMs: 600_000,
  };
}

function request(overrides: Partial<EgressRequest> = {}): EgressRequest {
  return {
    method: 'GET',
    url: 'https://www.server2.sidgad.es/rfep/rfep_ls_1.php',
    portal: 'rfep',
    endpointPath: 'rfep_ls_1.php',
    headers: { Referer: 'https://example.test/' },
    timeoutMs: 30_000,
    ...overrides,
  };
}

function raw(status: number, body = 'ok', extra: Partial<RawEgressResponse> = {}): RawEgressResponse {
  return {
    status,
    body,
    setCookie: [],
    retryAfter: null,
    latencyMs: 5,
    url: 'https://www.server2.sidgad.es/rfep/rfep_ls_1.php',
    ...extra,
  };
}

class FakeTransport implements EgressTransport {
  calls = 0;
  constructor(private readonly handler: (call: number) => RawEgressResponse | Promise<RawEgressResponse>) {}
  async execute(): Promise<RawEgressResponse> {
    this.calls++;
    return this.handler(this.calls);
  }
}

function makeEgress(options: {
  config?: EgressConfig;
  transports?: Partial<Record<EgressConfig['primary'], EgressTransport>>;
  now?: () => number;
}) {
  const sleeps: number[] = [];
  const alerts: EgressAlert[] = [];
  const egress = new SidgadEgress({
    config: options.config ?? makeConfig('direct'),
    ...(options.transports ? { transports: options.transports } : {}),
    ...(options.now ? { now: options.now } : {}),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    alert: (alert) => alerts.push(alert),
  });
  return { egress, sleeps, alerts };
}

describe('SidgadEgress', () => {
  it('usa la ruta directa y registra métricas', async () => {
    const direct = new FakeTransport(() => raw(200, 'hola'));
    const { egress } = makeEgress({ transports: { direct } });

    const response = await egress.request(request());
    expect(response.route).toBe('direct');
    expect(response.body).toBe('hola');
    expect(direct.calls).toBe(1);

    const entry = egress.metrics.snapshot().entries[0]!;
    expect(entry).toMatchObject({ route: 'direct', requests: 1, successes: 1, failures: 0 });
  });

  it('un 403 no se reintenta y no prueba el fallback', async () => {
    const direct = new FakeTransport(() => raw(403));
    const fallback = new FakeTransport(() => raw(200));
    const { egress, alerts, sleeps } = makeEgress({
      config: makeConfig('direct', ['cloudflare']),
      transports: { direct, cloudflare: fallback },
    });

    await expect(egress.request(request())).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403,
      retryable: false,
      failover: false,
    });
    expect(direct.calls).toBe(1);
    expect(fallback.calls).toBe(0);
    expect(sleeps).toEqual([]);
    expect(alerts.some((a) => a.kind === 'forbidden')).toBe(true);
  });

  it('un 429 respeta Retry-After y no cambia de ruta', async () => {
    const direct = new FakeTransport((call) =>
      call === 1 ? raw(429, '', { retryAfter: '7' }) : raw(200, 'ok')
    );
    const fallback = new FakeTransport(() => raw(200));
    const { egress, sleeps } = makeEgress({
      config: makeConfig('direct', ['cloudflare']),
      transports: { direct, cloudflare: fallback },
    });

    const response = await egress.request(request());
    expect(response.route).toBe('direct');
    expect(direct.calls).toBe(2);
    expect(fallback.calls).toBe(0);
    expect(sleeps).toEqual([7000]);
    expect(egress.metrics.snapshot().entries[0]!.retries).toBe(1);
  });

  it('un 429 con Retry-After enorme se acota al máximo configurado', async () => {
    const direct = new FakeTransport((call) =>
      call === 1 ? raw(429, '', { retryAfter: '3600' }) : raw(200, 'ok')
    );
    const { egress, sleeps } = makeEgress({ transports: { direct } });
    await egress.request(request());
    expect(sleeps).toEqual([60_000]);
  });

  it('un 500 se reintenta con backoff y termina sin cambiar de ruta', async () => {
    const direct = new FakeTransport(() => raw(503));
    const fallback = new FakeTransport(() => raw(200));
    const { egress, sleeps } = makeEgress({
      config: makeConfig('direct', ['cloudflare']),
      transports: { direct, cloudflare: fallback },
    });

    await expect(egress.request(request())).rejects.toMatchObject({
      kind: 'server',
      status: 503,
      failover: false,
    });
    expect(direct.calls).toBe(3);
    expect(fallback.calls).toBe(0);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('un 404 no se reintenta ni cambia de ruta', async () => {
    const direct = new FakeTransport(() => raw(404));
    const fallback = new FakeTransport(() => raw(200));
    const { egress } = makeEgress({
      config: makeConfig('direct', ['cloudflare']),
      transports: { direct, cloudflare: fallback },
    });
    await expect(egress.request(request())).rejects.toMatchObject({ kind: 'client', status: 404 });
    expect(direct.calls).toBe(1);
    expect(fallback.calls).toBe(0);
  });

  it('un fallo DNS agota reintentos y prueba la ruta alternativa', async () => {
    const direct = new FakeTransport(() => {
      throw Object.assign(new Error('dns'), { code: 'ENOTFOUND' });
    });
    const fallback = new FakeTransport(() => raw(200, 'por-worker'));
    const { egress, alerts } = makeEgress({
      config: makeConfig('direct', ['cloudflare']),
      transports: { direct, cloudflare: fallback },
    });

    const response = await egress.request(request());
    expect(response.route).toBe('cloudflare');
    expect(response.body).toBe('por-worker');
    expect(direct.calls).toBe(3);
    expect(fallback.calls).toBe(1);
    expect(alerts.some((a) => a.kind === 'circuit_open')).toBe(false);

    const metrics = egress.metrics.snapshot().entries;
    expect(metrics.find((m) => m.route === 'direct')?.failovers).toBe(1);
    expect(metrics.find((m) => m.route === 'cloudflare')?.successes).toBe(1);
  });

  it('abre el circuito tras N fallos y lo cierra al recuperarse', async () => {
    let now = 0;
    let directMode: 'fail' | 'ok' = 'fail';
    const direct = new FakeTransport(() => {
      if (directMode === 'fail') throw Object.assign(new Error('net'), { code: 'ECONNRESET' });
      return raw(200, 'directo');
    });
    const fallback = new FakeTransport(() => raw(200, 'fallback'));
    const config = { ...makeConfig('direct', ['cloudflare']), circuitFailureThreshold: 2, circuitCooldownMs: 1000 };
    const { egress, alerts } = makeEgress({
      config,
      transports: { direct, cloudflare: fallback },
      now: () => now,
    });

    // Dos peticiones con la directa caída: el servicio sigue vivo por el
    // fallback, y la directa abre su circuito.
    const first = await egress.request(request({ retries: 1 }));
    const second = await egress.request(request({ retries: 1 }));
    expect(first.route).toBe('cloudflare');
    expect(second.route).toBe('cloudflare');
    expect(alerts.some((a) => a.kind === 'circuit_open')).toBe(true);
    expect(direct.calls).toBe(2);

    // Tercera: la directa se omite (sin tocar la red) y entra el fallback.
    const third = await egress.request(request({ retries: 1 }));
    expect(third.route).toBe('cloudflare');
    expect(direct.calls).toBe(2);
    expect(egress.metrics.snapshot().entries.find((m) => m.route === 'direct')?.circuitRejects).toBe(1);

    // Tras el enfriamiento, la directa recibe una prueba y se recupera.
    now = 1500;
    directMode = 'ok';
    const fourth = await egress.request(request({ retries: 1 }));
    expect(fourth.route).toBe('direct');
    expect(alerts.some((a) => a.kind === 'circuit_recovered')).toBe(true);
  });

  it('si todas las rutas están abiertas falla rápido sin tocar la red', async () => {
    let now = 0;
    const direct = new FakeTransport(() => {
      throw Object.assign(new Error('net'), { code: 'ECONNRESET' });
    });
    const fallback = new FakeTransport(() => {
      throw Object.assign(new Error('net'), { code: 'ECONNRESET' });
    });
    const config = {
      ...makeConfig('direct', ['cloudflare']),
      circuitFailureThreshold: 1,
      circuitCooldownMs: 10_000,
    };
    const { egress } = makeEgress({
      config,
      transports: { direct, cloudflare: fallback },
      now: () => now,
    });

    await expect(egress.request(request({ retries: 1 }))).rejects.toBeDefined();
    const callsAfterOpen = direct.calls + fallback.calls;

    // Circuitos abiertos: la petición no debe llegar a ningún transporte.
    await expect(egress.request(request({ retries: 1 }))).rejects.toBeDefined();
    expect(direct.calls + fallback.calls).toBe(callsAfterOpen);

    now = 20_000;
    await expect(egress.request(request({ retries: 1 }))).rejects.toBeDefined();
    expect(direct.calls + fallback.calls).toBeGreaterThan(callsAfterOpen);
  });

  it('un error de configuración del Worker no se reintenta, pero usa el fallback y alerta', async () => {
    const cloudflare = new FakeTransport(() => raw(401, '', { errorCode: 'unauthorized' }));
    const fallback = new FakeTransport(() => raw(200, 'directo'));
    const { egress, alerts } = makeEgress({
      config: makeConfig('cloudflare', ['direct']),
      transports: { cloudflare, direct: fallback },
    });

    const response = await egress.request(request());
    expect(response.route).toBe('direct');
    expect(response.body).toBe('directo');
    expect(cloudflare.calls).toBe(1);
    expect(fallback.calls).toBe(1);
    expect(alerts.some((a) => a.kind === 'config')).toBe(true);
  });

  it('un error de configuración sin fallback se propaga', async () => {
    const cloudflare = new FakeTransport(() => raw(401, '', { errorCode: 'unauthorized' }));
    const { egress } = makeEgress({
      config: makeConfig('cloudflare'),
      transports: { cloudflare },
    });

    await expect(egress.request(request())).rejects.toMatchObject({ kind: 'config' });
    expect(cloudflare.calls).toBe(1);
  });

  it('un timeout del Worker sí es failover-eligible', async () => {
    const cloudflare = new FakeTransport(() => raw(504, '', { errorCode: 'upstream_timeout' }));
    const fallback = new FakeTransport(() => raw(200, 'directo'));
    const { egress } = makeEgress({
      config: makeConfig('cloudflare', ['direct']),
      transports: { cloudflare, direct: fallback },
    });

    const response = await egress.request(request());
    expect(response.route).toBe('direct');
    expect(cloudflare.calls).toBe(3);
    expect(fallback.calls).toBe(1);
  });

  it('snapshot incluye configuración segura, métricas y circuitos', async () => {
    const direct = new FakeTransport(() => raw(200));
    const { egress } = makeEgress({ transports: { direct } });
    await egress.request(request());
    const snapshot = egress.snapshot() as {
      config: Record<string, unknown>;
      metrics: { entries: unknown[] };
      circuits: unknown[];
    };
    expect(snapshot.config.primary).toBe('direct');
    expect(snapshot.metrics.entries).toHaveLength(1);
    expect(snapshot.circuits).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain('a'.repeat(64));
  });
});
