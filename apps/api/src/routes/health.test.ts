import { describe, it, expect } from 'vitest';

// `@sports/db` exige DATABASE_URL al importarse (aunque el pool no conecta hasta
// la primera query). La liveness no consulta la BD, pero el módulo la importa.
process.env['DATABASE_URL'] ??= 'postgres://localhost:5432/test';

const { healthRouter } = await import('./health.js');

/**
 * Incidente 2026-10-05: el healthcheck del contenedor apuntaba a `/health`, que
 * hace `SELECT 1`. Un bache de Postgres marcaba la API como `unhealthy` y
 * `autoheal` la reiniciaba (pool en frío + 502s). La liveness debe responder
 * SIEMPRE que el proceso esté vivo, sin tocar la BD.
 */
describe('GET /health/live', () => {
  it('responde 200 con status ok', async () => {
    const res = await healthRouter.request('/health/live');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; timestamp: string };
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
  });

  it('no depende de Postgres (responde aunque no haya BD)', async () => {
    // DATABASE_URL apunta a un host inexistente: si la liveness consultara la BD,
    // esta petición tardaría los 5 s de connectionTimeout o fallaría.
    const t0 = Date.now();
    const res = await healthRouter.request('/health/live');
    expect(res.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
