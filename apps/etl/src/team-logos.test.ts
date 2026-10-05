import { describe, it, expect } from 'vitest';

// `@sports/db` exige DATABASE_URL al importarse (el pool no conecta al importar).
process.env['DATABASE_URL'] ??= 'postgres://localhost:5432/test';

const { planLogoAction } = await import('./team-logos.js');

/**
 * La entidad `download-logos` del scheduler antes solo cubría 14 equipos de un
 * mapa hardcodeado; ahora se decide por `teams.logo_url` (fuente única), igual
 * que `/teams/:id/logo`.
 */
describe('planLogoAction', () => {
  it('con fichero local → normalizar (aunque no haya logo_url)', () => {
    expect(planLogoAction(null, true)).toEqual({ kind: 'normalize' });
    expect(planLogoAction('https://cdn/x.png', true)).toEqual({ kind: 'normalize' });
  });

  it('sin fichero pero con logo_url → descargar', () => {
    expect(planLogoAction('https://cdn/x.png', false)).toEqual({
      kind: 'download',
      url: 'https://cdn/x.png',
    });
  });

  it('sin fichero ni logo_url → no hay fuente (hueco de datos)', () => {
    expect(planLogoAction(null, false)).toEqual({ kind: 'skip', reason: 'no-logo-url' });
  });
});
