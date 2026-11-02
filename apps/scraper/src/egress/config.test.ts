import { describe, expect, it } from 'vitest';
import { describeEgressConfig, loadEgressConfig } from './config.js';

const SECRET = 'a'.repeat(64);

describe('loadEgressConfig', () => {
  it('por defecto sale por la ruta directa, sin fallbacks', () => {
    const config = loadEgressConfig({});
    expect(config.primary).toBe('direct');
    expect(config.fallbacks).toEqual([]);
    expect(config.routes.direct.enabled).toBe(true);
    expect(config.routes.direct.authorized).toBe(true);
    expect(config.routes.cloudflare.enabled).toBe(false);
    expect(config.routes['secondary-ip'].enabled).toBe(false);
    expect(config.retries).toBe(3);
    expect(config.timeoutMs).toBe(30_000);
  });

  it('respeta los timeouts y delays históricos del scraper', () => {
    const config = loadEgressConfig({
      SCRAPER_REQUEST_TIMEOUT_MS: '12000',
      SCRAPER_RETRY_DELAY_MS: '750',
    });
    expect(config.timeoutMs).toBe(12_000);
    expect(config.retryBaseMs).toBe(750);
  });

  it('una ruta alternativa habilitada sin autorización falla al arrancar', () => {
    expect(() =>
      loadEgressConfig({
        SIDGAD_EGRESS_CLOUDFLARE_ENABLED: '1',
        SIDGAD_EGRESS_WORKER_URL: 'https://sidgad.example.workers.dev',
        SIDGAD_EGRESS_WORKER_SECRET: SECRET,
      })
    ).toThrow(/no está autorizada/i);
  });

  it('cloudflare autorizado pero sin URL/secreto falla con mensaje accionable', () => {
    expect(() =>
      loadEgressConfig({
        SIDGAD_EGRESS_CLOUDFLARE_ENABLED: '1',
        SIDGAD_EGRESS_CLOUDFLARE_AUTHORIZED: '1',
      })
    ).toThrow(/SIDGAD_EGRESS_WORKER_URL/);
  });

  it('rechaza secretos demasiado cortos', () => {
    expect(() =>
      loadEgressConfig({
        SIDGAD_EGRESS_CLOUDFLARE_ENABLED: '1',
        SIDGAD_EGRESS_CLOUDFLARE_AUTHORIZED: '1',
        SIDGAD_EGRESS_WORKER_URL: 'https://sidgad.example.workers.dev',
        SIDGAD_EGRESS_WORKER_SECRET: 'corto',
      })
    ).toThrow(/al menos 32 caracteres/i);
  });

  it('acepta cloudflare completamente configurado y normaliza la URL', () => {
    const config = loadEgressConfig({
      SIDGAD_EGRESS_PRIMARY: 'cloudflare',
      SIDGAD_EGRESS_CLOUDFLARE_ENABLED: '1',
      SIDGAD_EGRESS_CLOUDFLARE_AUTHORIZED: '1',
      SIDGAD_EGRESS_WORKER_URL: 'https://sidgad.example.workers.dev/',
      SIDGAD_EGRESS_WORKER_SECRET: SECRET,
    });
    expect(config.primary).toBe('cloudflare');
    expect(config.routes.cloudflare.workerUrl).toBe('https://sidgad.example.workers.dev');
    expect(config.routes.cloudflare.workerSecret).toBe(SECRET);
  });

  it('rechaza una URL de Worker con path', () => {
    expect(() =>
      loadEgressConfig({
        SIDGAD_EGRESS_CLOUDFLARE_ENABLED: '1',
        SIDGAD_EGRESS_CLOUDFLARE_AUTHORIZED: '1',
        SIDGAD_EGRESS_WORKER_URL: 'https://sidgad.example.workers.dev/proxy',
        SIDGAD_EGRESS_WORKER_SECRET: SECRET,
      })
    ).toThrow(/solo el origen/i);
  });

  it('secondary-ip exige una IP válida y autorización', () => {
    expect(() =>
      loadEgressConfig({
        SIDGAD_EGRESS_SECONDARY_IP_ENABLED: '1',
        SIDGAD_EGRESS_SECONDARY_IP_AUTHORIZED: '1',
        SIDGAD_EGRESS_SECONDARY_SOURCE_IP: 'no-es-una-ip',
      })
    ).toThrow(/no es una IP válida/i);

    const config = loadEgressConfig({
      SIDGAD_EGRESS_SECONDARY_IP_ENABLED: '1',
      SIDGAD_EGRESS_SECONDARY_IP_AUTHORIZED: '1',
      SIDGAD_EGRESS_SECONDARY_SOURCE_IP: '203.0.113.10',
    });
    expect(config.routes['secondary-ip'].sourceIp).toBe('203.0.113.10');
  });

  it('un fallback no habilitado falla en vez de ignorarse', () => {
    expect(() =>
      loadEgressConfig({
        SIDGAD_EGRESS_FALLBACKS: 'secondary-ip',
      })
    ).toThrow(/no está habilitada/i);
  });

  it('rechaza fallbacks repetidos o iguales a la primaria', () => {
    expect(() =>
      loadEgressConfig({ SIDGAD_EGRESS_FALLBACKS: 'direct' })
    ).toThrow(/ruta primaria/i);

    expect(() =>
      loadEgressConfig({
        SIDGAD_EGRESS_SECONDARY_IP_ENABLED: '1',
        SIDGAD_EGRESS_SECONDARY_IP_AUTHORIZED: '1',
        SIDGAD_EGRESS_SECONDARY_SOURCE_IP: '203.0.113.10',
        SIDGAD_EGRESS_FALLBACKS: 'secondary-ip,secondary-ip',
      })
    ).toThrow(/repetidas/i);
  });

  it('rechaza valores numéricos y booleanos inválidos', () => {
    expect(() => loadEgressConfig({ SIDGAD_EGRESS_RETRIES: 'muchas' })).toThrow(/entero válido/i);
    expect(() => loadEgressConfig({ SIDGAD_EGRESS_CLOUDFLARE_ENABLED: 'sí' })).toThrow(
      /booleano válido/i
    );
  });

  it('describeEgressConfig no filtra el secreto ni la URL del Worker', () => {
    const config = loadEgressConfig({
      SIDGAD_EGRESS_CLOUDFLARE_ENABLED: '1',
      SIDGAD_EGRESS_CLOUDFLARE_AUTHORIZED: '1',
      SIDGAD_EGRESS_WORKER_URL: 'https://sidgad.example.workers.dev',
      SIDGAD_EGRESS_WORKER_SECRET: SECRET,
    });
    const described = JSON.stringify(describeEgressConfig(config));
    expect(described).not.toContain(SECRET);
    expect(described).not.toContain('sidgad.example.workers.dev');
    expect(described).toContain('"configured":true');
  });
});
