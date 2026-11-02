/**
 * Métricas en memoria de la salida SIDGAD.
 *
 * No introduce Prometheus ni un servicio nuevo: se publican como resumen
 * estructurado en el log existente (pino), que es lo que ya se consulta con
 * `docker logs etl`. Además, el ETL ya tiene Sentry para las alertas.
 */
import type { EgressMetricEntry, EgressRouteKind, SidgadFailureKind } from './types.js';

const MAX_LATENCY_SAMPLES = 100;

interface InternalEntry {
  route: EgressRouteKind;
  portal: string;
  requests: number;
  successes: number;
  failures: number;
  retries: number;
  failovers: number;
  circuitRejects: number;
  circuitOpens: number;
  recoveries: number;
  consecutiveFailures: number;
  lastErrorKind?: SidgadFailureKind;
  lastStatus?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastRecoveredAt?: number;
  latencies: number[];
}

function key(route: EgressRouteKind, portal: string): string {
  return `${route}:${portal}`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function iso(value: number | undefined): string | undefined {
  return value === undefined ? undefined : new Date(value).toISOString();
}

export class EgressMetrics {
  private readonly entries = new Map<string, InternalEntry>();

  private entry(route: EgressRouteKind, portal: string): InternalEntry {
    const k = key(route, portal);
    let entry = this.entries.get(k);
    if (!entry) {
      entry = {
        route,
        portal,
        requests: 0,
        successes: 0,
        failures: 0,
        retries: 0,
        failovers: 0,
        circuitRejects: 0,
        circuitOpens: 0,
        recoveries: 0,
        consecutiveFailures: 0,
        latencies: [],
      };
      this.entries.set(k, entry);
    }
    return entry;
  }

  recordRequest(route: EgressRouteKind, portal: string): void {
    this.entry(route, portal).requests++;
  }

  recordSuccess(route: EgressRouteKind, portal: string, latencyMs: number, recovered = false, now = Date.now()): void {
    const e = this.entry(route, portal);
    e.successes++;
    e.consecutiveFailures = 0;
    e.lastSuccessAt = now;
    if (recovered) {
      e.recoveries++;
      e.lastRecoveredAt = now;
    }
    e.latencies.push(Math.max(0, Math.round(latencyMs)));
    if (e.latencies.length > MAX_LATENCY_SAMPLES) e.latencies.shift();
  }

  recordFailure(
    route: EgressRouteKind,
    portal: string,
    error: { kind: SidgadFailureKind; status?: number },
    now = Date.now()
  ): void {
    const e = this.entry(route, portal);
    e.failures++;
    e.consecutiveFailures++;
    e.lastErrorKind = error.kind;
    if (error.status !== undefined) e.lastStatus = error.status;
    e.lastFailureAt = now;
  }

  recordRetry(route: EgressRouteKind, portal: string): void {
    this.entry(route, portal).retries++;
  }

  recordFailover(from: EgressRouteKind, portal: string): void {
    this.entry(from, portal).failovers++;
  }

  recordCircuitReject(route: EgressRouteKind, portal: string): void {
    this.entry(route, portal).circuitRejects++;
  }

  recordCircuitOpen(route: EgressRouteKind, portal: string): void {
    this.entry(route, portal).circuitOpens++;
  }

  snapshot(): { entries: EgressMetricEntry[] } {
    const entries: EgressMetricEntry[] = [];
    for (const e of this.entries.values()) {
      const sorted = [...e.latencies].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, value) => acc + value, 0);
      entries.push({
        route: e.route,
        portal: e.portal,
        requests: e.requests,
        successes: e.successes,
        failures: e.failures,
        retries: e.retries,
        failovers: e.failovers,
        circuitRejects: e.circuitRejects,
        circuitOpens: e.circuitOpens,
        recoveries: e.recoveries,
        consecutiveFailures: e.consecutiveFailures,
        ...(e.lastErrorKind ? { lastErrorKind: e.lastErrorKind } : {}),
        ...(e.lastStatus !== undefined ? { lastStatus: e.lastStatus } : {}),
        ...(iso(e.lastSuccessAt) ? { lastSuccessAt: iso(e.lastSuccessAt) } : {}),
        ...(iso(e.lastFailureAt) ? { lastFailureAt: iso(e.lastFailureAt) } : {}),
        ...(iso(e.lastRecoveredAt) ? { lastRecoveredAt: iso(e.lastRecoveredAt) } : {}),
        latency: {
          count: sorted.length,
          lastMs: e.latencies[e.latencies.length - 1] ?? 0,
          avgMs: sorted.length > 0 ? Math.round(sum / sorted.length) : 0,
          p95Ms: percentile(sorted, 95),
        },
      });
    }
    return { entries };
  }

  reset(): void {
    this.entries.clear();
  }
}
