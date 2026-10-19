import { describe, it, expect } from 'vitest';
import { competitionLogoUrl } from './competition-logo.js';

describe('competitionLogoUrl — logo del catálogo de la fuente', () => {
  it('construye la URL del CDN del portal', () => {
    expect(competitionLogoUrl('rfep', '2478.png'))
      .toBe('https://sidgad.cloud/rfep/images/logos_competiciones/2478.png');
    expect(competitionLogoUrl('fecapa', '/ok.svg'))
      .toBe('https://sidgad.cloud/fecapa/images/logos_competiciones/ok.svg');
  });

  it('descarta el logo genérico o vacío', () => {
    expect(competitionLogoUrl('rfep', 'default.png')).toBeNull();
    expect(competitionLogoUrl('rfep', '')).toBeNull();
    expect(competitionLogoUrl('rfep', null)).toBeNull();
  });
});
