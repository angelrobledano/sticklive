import { describe, expect, it } from 'vitest';
import {
  classifyTransportError,
  computeBackoffMs,
  httpError,
  isFailoverEligible,
  parseRetryAfter,
} from './errors.js';

function codedError(code: string): Error {
  return Object.assign(new Error(`fallo ${code}`), { code });
}

const common = { route: 'direct' as const, portal: 'rfep', url: 'https://example.test/x.php' };

describe('httpError', () => {
  it('403 es forbidden: no se reintenta ni se cambia de ruta', () => {
    const error = httpError({ status: 403, ...common, retryAfter: null });
    expect(error.kind).toBe('forbidden');
    expect(error.retryable).toBe(false);
    expect(error.failover).toBe(false);
    expect(error.message).toMatch(/no se cambia de ruta/i);
  });

  it('401 también es forbidden y no se reintenta', () => {
    const error = httpError({ status: 401, ...common, retryAfter: null });
    expect(error.kind).toBe('forbidden');
    expect(error.retryable).toBe(false);
  });

  it('429 es rate_limited, reintentable y SIN failover', () => {
    const error = httpError({ status: 429, ...common, retryAfter: '7' });
    expect(error.kind).toBe('rate_limited');
    expect(error.retryable).toBe(true);
    expect(error.failover).toBe(false);
    expect(error.retryAfterMs).toBe(7000);
  });

  it('5xx es server, reintentable y SIN failover', () => {
    const error = httpError({ status: 503, ...common, retryAfter: null });
    expect(error.kind).toBe('server');
    expect(error.retryable).toBe(true);
    expect(error.failover).toBe(false);
  });

  it('404 es client y no se reintenta', () => {
    const error = httpError({ status: 404, ...common, retryAfter: null });
    expect(error.kind).toBe('client');
    expect(error.retryable).toBe(false);
    expect(error.failover).toBe(false);
  });

  it('408 se reintenta pero no cambia de ruta', () => {
    const error = httpError({ status: 408, ...common, retryAfter: null });
    expect(error.retryable).toBe(true);
    expect(error.failover).toBe(false);
  });
});

describe('classifyTransportError', () => {
  it('DNS es failover-eligible', () => {
    const error = classifyTransportError(codedError('ENOTFOUND'), { ...common, timedOut: false });
    expect(error.kind).toBe('dns');
    expect(error.retryable).toBe(true);
    expect(isFailoverEligible(error)).toBe(true);
  });

  it('conexión rechazada es network y failover-eligible', () => {
    const error = classifyTransportError(codedError('ECONNREFUSED'), { ...common, timedOut: false });
    expect(error.kind).toBe('network');
    expect(isFailoverEligible(error)).toBe(true);
  });

  it('timeout del AbortController es timeout y failover-eligible', () => {
    const error = classifyTransportError(new Error('abort'), { ...common, timedOut: true });
    expect(error.kind).toBe('timeout');
    expect(isFailoverEligible(error)).toBe(true);
  });

  it('un error TLS no se reintenta ni cambia de ruta', () => {
    const error = classifyTransportError(codedError('CERT_HAS_EXPIRED'), { ...common, timedOut: false });
    expect(error.kind).toBe('tls');
    expect(error.retryable).toBe(false);
    expect(error.failover).toBe(false);
  });

  it('una respuesta demasiado grande no se reintenta', () => {
    const big = new Error('grande');
    big.name = 'ResponseTooLargeError';
    const error = classifyTransportError(big, { ...common, timedOut: false });
    expect(error.kind).toBe('response_too_large');
    expect(error.retryable).toBe(false);
  });

  it('un TypeError de fetch se trata como red', () => {
    const error = classifyTransportError(new TypeError('fetch failed'), { ...common, timedOut: false });
    expect(error.kind).toBe('network');
  });
});

describe('parseRetryAfter', () => {
  it('segundos', () => {
    expect(parseRetryAfter('12')).toBe(12_000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('fecha HTTP', () => {
    const now = Date.parse('2026-11-02T10:00:00Z');
    expect(parseRetryAfter('Mon, 02 Nov 2026 10:00:30 GMT', now)).toBe(30_000);
  });

  it('valores inválidos o vacíos', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('no')).toBeUndefined();
  });
});

describe('computeBackoffMs', () => {
  it('crece exponencialmente y respeta el máximo', () => {
    const half = () => 0.5; // jitter neutro
    expect(computeBackoffMs(1, 1000, 30_000, half)).toBe(1000);
    expect(computeBackoffMs(2, 1000, 30_000, half)).toBe(2000);
    expect(computeBackoffMs(3, 1000, 30_000, half)).toBe(4000);
    expect(computeBackoffMs(10, 1000, 30_000, half)).toBe(30_000);
  });

  it('el jitter se queda dentro de ±20%', () => {
    expect(computeBackoffMs(2, 1000, 30_000, () => 0)).toBe(1600);
    expect(computeBackoffMs(2, 1000, 30_000, () => 1)).toBe(2400);
  });
});
