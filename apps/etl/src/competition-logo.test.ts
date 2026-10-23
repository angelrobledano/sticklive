import { describe, it, expect } from 'vitest';
import { competitionLogoUrl, idcFromSourceRef } from './competition-logo.js';

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

describe('idcFromSourceRef — idc del catálogo desde competitions.source_ref', () => {
  it('quita el prefijo de cualquier portal', () => {
    expect(idcFromSourceRef('fecapa_competition_4774')).toBe('4774');
    expect(idcFromSourceRef('fgp_competition_4853934')).toBe('4853934');
    expect(idcFromSourceRef('wse_competition_320')).toBe('320');
    expect(idcFromSourceRef('fep_competition_3150')).toBe('3150');
  });
  it('el idc pelado (RFEP) se queda igual', () => {
    expect(idcFromSourceRef('3568')).toBe('3568');
    expect(idcFromSourceRef(null)).toBe('');
  });
});
