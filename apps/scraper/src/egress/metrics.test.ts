import { describe, expect, it } from 'vitest';
import { EgressMetrics } from './metrics.js';

describe('EgressMetrics', () => {
  it('cuenta peticiones, éxitos, fallos, reintentos y failovers por ruta+portal', () => {
    const metrics = new EgressMetrics();
    metrics.recordRequest('direct', 'rfep');
    metrics.recordRetry('direct', 'rfep');
    metrics.recordFailure('direct', 'rfep', { kind: 'network' }, 1000);
    metrics.recordRequest('cloudflare', 'rfep');
    metrics.recordSuccess('cloudflare', 'rfep', 120, false, 2000);

    const snapshot = metrics.snapshot();
    const direct = snapshot.entries.find((e) => e.route === 'direct');
    const cf = snapshot.entries.find((e) => e.route === 'cloudflare');

    expect(direct).toMatchObject({
      portal: 'rfep',
      requests: 1,
      successes: 0,
      failures: 1,
      retries: 1,
      consecutiveFailures: 1,
      lastErrorKind: 'network',
    });
    expect(cf).toMatchObject({ requests: 1, successes: 1, failures: 0, consecutiveFailures: 0 });
    expect(cf?.latency).toMatchObject({ count: 1, lastMs: 120, avgMs: 120, p95Ms: 120 });
  });

  it('un éxito resetea la racha de fallos y registra recuperación', () => {
    const metrics = new EgressMetrics();
    metrics.recordFailure('direct', 'rfep', { kind: 'timeout' });
    metrics.recordFailure('direct', 'rfep', { kind: 'timeout' });
    metrics.recordSuccess('direct', 'rfep', 50, true, 5000);

    const entry = metrics.snapshot().entries[0]!;
    expect(entry.consecutiveFailures).toBe(0);
    expect(entry.recoveries).toBe(1);
    expect(entry.lastRecoveredAt).toBe(new Date(5000).toISOString());
  });

  it('calcula p95 sobre las últimas muestras', () => {
    const metrics = new EgressMetrics();
    for (let i = 1; i <= 100; i++) metrics.recordSuccess('direct', 'rfep', i * 10);
    const latency = metrics.snapshot().entries[0]!.latency;
    expect(latency.count).toBe(100);
    expect(latency.p95Ms).toBe(950);
    expect(latency.avgMs).toBe(505);
  });

  it('solo conserva las últimas 100 latencias', () => {
    const metrics = new EgressMetrics();
    for (let i = 1; i <= 150; i++) metrics.recordSuccess('direct', 'rfep', i);
    const latency = metrics.snapshot().entries[0]!.latency;
    expect(latency.count).toBe(100);
    expect(latency.lastMs).toBe(150);
  });

  it('reset vacía las métricas', () => {
    const metrics = new EgressMetrics();
    metrics.recordRequest('direct', 'rfep');
    metrics.reset();
    expect(metrics.snapshot().entries).toEqual([]);
  });
});
